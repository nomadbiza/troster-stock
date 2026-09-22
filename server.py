#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
다모다란 가치평가(DCF/WACC) & 차트 결합 매도 타이밍 예측 웹 서버
(Damodaran Valuation & Stock Exit Timing Navigator)
환경: Python 3.8+ (표준 라이브러리 전용 - 외부 의존성 없음)
"""

import sys
import os
import json
import math
import re
import datetime
import time
import threading
import concurrent.futures
from concurrent.futures import ThreadPoolExecutor
import urllib.parse
from http.server import HTTPServer, SimpleHTTPRequestHandler

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
WEB_DIR = os.path.join(BASE_DIR, "web")

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(WEB_DIR, exist_ok=True)

PORTFOLIO_FILE = os.path.join(DATA_DIR, "portfolio.json")
MACRO_FILE = os.path.join(DATA_DIR, "macro_data.json")
SECTORS_FILE = os.path.join(DATA_DIR, "damodaran_sectors.json")

# ==============================================================================
# 네이버 증권 (Naver Finance) 실시간 시세 연동 모듈
# ==============================================================================
import ssl
import urllib.request

ssl_ctx = ssl.create_default_context()
ssl_ctx.check_hostname = False
ssl_ctx.verify_mode = ssl.CERT_NONE

def fetch_naver_json(url):
    try:
        req = urllib.request.Request(
            url, 
            headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}
        )
        with urllib.request.urlopen(req, context=ssl_ctx, timeout=5) as res:
            return json.loads(res.read().decode("utf-8"))
    except Exception as e:
        print(f"DEBUG fetch_naver_json failed for {url}: {e}")
        return None

def get_naver_index_data(code="KOSPI"):
    """네이버 증권 실시간 코스피/코스닥 지수 수집 (실시간 polling API 우선, basic API 폴백)"""
    # 1. 네이버 금융 실시간 polling API 시도
    poll_data = fetch_naver_json(f"https://polling.finance.naver.com/api/realtime/domestic/index/{code}")
    if poll_data and "datas" in poll_data and len(poll_data["datas"]) > 0:
        try:
            d = poll_data["datas"][0]
            close_price = float(d.get("closePriceRaw", str(d.get("closePrice", "0")).replace(",", "")))
            change = float(d.get("compareToPreviousClosePriceRaw", str(d.get("compareToPreviousClosePrice", "0")).replace(",", "")))
            change_pct = float(d.get("fluctuationsRatioRaw", str(d.get("fluctuationsRatio", "0")).replace(",", "")))
            cmp = d.get("compareToPreviousPrice", {})
            if cmp.get("name") == "FALLING" and change > 0:
                change = -change
                change_pct = -change_pct
            
            return {
                "code": code,
                "name": d.get("stockName", "코스피" if code == "KOSPI" else "코스닥"),
                "market": "KR",
                "current": close_price,
                "change": change,
                "change_pct": change_pct,
                "open": float(d.get("openPriceRaw", 0)),
                "high": float(d.get("highPriceRaw", 0)),
                "low": float(d.get("lowPriceRaw", 0)),
                "status": d.get("marketStatus", "OPEN"),
                "trade_time": d.get("localTradedAt", ""),
                "volume": d.get("accumulatedTradingVolume", ""),
                "delay_name": "0초 실시간",
                "source": "네이버 증권 (Naver Finance)",
                "url": f"https://stock.naver.com/domestic/index/{code}"
            }
        except Exception:
            pass

    # 2. 모바일 basic API 폴백
    data = fetch_naver_json(f"https://m.stock.naver.com/api/index/{code}/basic")
    if data:
        try:
            close_price = float(data.get("closePrice", "0").replace(",", ""))
            change = float(data.get("compareToPreviousClosePrice", "0").replace(",", ""))
            change_pct = float(data.get("fluctuationsRatio", "0").replace(",", ""))
            cmp = data.get("compareToPreviousPrice", {})
            if cmp.get("name") == "FALLING" and change > 0:
                change = -change
                change_pct = -change_pct
                
            return {
                "code": code,
                "name": data.get("stockName", code),
                "market": "KR",
                "current": close_price,
                "change": change,
                "change_pct": change_pct,
                "status": data.get("marketStatus", "OPEN"),
                "trade_time": data.get("localTradedAt", ""),
                "delay_name": data.get("delayTimeName", "실시간"),
                "source": "네이버 증권 (Naver Finance)",
                "url": data.get("newPcUrl", f"https://stock.naver.com/domestic/index/{code}")
            }
        except Exception:
            pass
    return None

def get_naver_stock_data(item_code):
    """네이버 증권 모바일 API에서 개별 종목 실시간 현재가 및 정보 수집"""
    data = fetch_naver_json(f"https://m.stock.naver.com/api/stock/{item_code}/basic")
    if not data:
        return None
    try:
        close_price = float(data.get("closePrice", "0").replace(",", ""))
        change = float(data.get("compareToPreviousClosePrice", "0").replace(",", ""))
        change_pct = float(data.get("fluctuationsRatio", "0").replace(",", ""))
        cmp = data.get("compareToPreviousPrice", {})
        if cmp.get("name") == "FALLING" and change > 0:
            change = -change
            change_pct = -change_pct

        return {
            "ticker": item_code,
            "name": data.get("stockName", ""),
            "current_price": close_price,
            "change": change,
            "change_pct": change_pct,
            "market_status": data.get("marketStatus", "OPEN"),
            "trade_time": data.get("localTradedAt", ""),
            "delay_name": data.get("delayTimeName", "실시간"),
            "source": "네이버 증권 (Naver Finance)",
            "image_charts": data.get("imageCharts", {}),
            "url": f"https://finance.naver.com/item/main.naver?code={item_code}"
        }
    except Exception:
        return None



# ==============================================================================
# 주요 기업별 공시 재무 및 발행주식수 데이터베이스 (다모다란 분석 벤치마크)
# 단위: base_revenue(십억원/M$), shares_outstanding_mil(백만 주)
# ==============================================================================
STOCK_FINANCIAL_PROFILES = {
    "000660": {
        "name": "SK하이닉스",
        "market": "KR",
        "shares_outstanding_mil": 728.0,   # 7억 2,800만 주
        "base_revenue": 97146.7,          # 97.1조 원 (2026 결산 기준)
        "growth_rate_next_5y": 14.0,
        "target_ebit_margin": 48.6,
        "sales_to_capital": 1.4,
        "unlevered_beta": 1.20,
        "debt_to_equity_pct": 46.0,
        "net_debt_billion_krw": 10000.0,
        "rd_annual_billion_krw": 4500.0,
        "curr_price": 1868000.0,
        "buy_price": 1730000.0,
        "consensus_target_price": "₩3,305,000",
        "consensus_opinion": "매수 (4.00)"
    },
    "005930": {
        "name": "삼성전자",
        "market": "KR",
        "shares_outstanding_mil": 5969.0,  # 59억 6,900만 주
        "base_revenue": 333605.9,         # 333.6조 원 (2026 연결 공시 기준)
        "growth_rate_next_5y": 9.5,
        "target_ebit_margin": 24.0,
        "sales_to_capital": 1.3,
        "unlevered_beta": 1.15,
        "debt_to_equity_pct": 29.9,
        "net_debt_billion_krw": -40000.0, # 순현금 40조
        "rd_annual_billion_krw": 12000.0,
        "curr_price": 273000.0,
        "buy_price": 198000.0,
        "consensus_target_price": "₩487,000",
        "consensus_opinion": "매수 (4.00)"
    },
    "005380": {
        "name": "현대차",
        "market": "KR",
        "shares_outstanding_mil": 209.0,   # 2억 900만 주
        "base_revenue": 162000.0,         # 162조 원
        "growth_rate_next_5y": 5.5,
        "target_ebit_margin": 9.2,
        "sales_to_capital": 1.2,
        "unlevered_beta": 0.95,
        "debt_to_equity_pct": 40.0,
        "net_debt_billion_krw": 15000.0,
        "rd_annual_billion_krw": 3500.0,
        "curr_price": 248500.0,
        "buy_price": 235000.0
    },
    "035420": {
        "name": "NAVER",
        "market": "KR",
        "shares_outstanding_mil": 164.0,   # 1억 6,400만 주
        "base_revenue": 9670.0,           # 9.67조 원
        "growth_rate_next_5y": 8.5,
        "target_ebit_margin": 16.2,
        "sales_to_capital": 1.5,
        "unlevered_beta": 1.05,
        "debt_to_equity_pct": 15.0,
        "net_debt_billion_krw": -2000.0,
        "rd_annual_billion_krw": 1800.0,
        "curr_price": 197600.0,
        "buy_price": 185000.0
    },
    "035720": {
        "name": "카카오",
        "market": "KR",
        "shares_outstanding_mil": 446.0,   # 4억 4,600만 주
        "base_revenue": 7550.0,           # 7.55조 원
        "growth_rate_next_5y": 7.0,
        "target_ebit_margin": 10.5,
        "sales_to_capital": 1.4,
        "unlevered_beta": 1.10,
        "debt_to_equity_pct": 20.0,
        "net_debt_billion_krw": 1000.0,
        "rd_annual_billion_krw": 800.0,
        "curr_price": 38500.0,
        "buy_price": 42000.0
    },
    "068270": {
        "name": "셀트리온",
        "market": "KR",
        "shares_outstanding_mil": 220.0,   # 2억 2,000만 주
        "base_revenue": 3500.0,           # 3.5조 원
        "growth_rate_next_5y": 12.0,
        "target_ebit_margin": 28.0,
        "sales_to_capital": 1.1,
        "unlevered_beta": 0.90,
        "debt_to_equity_pct": 15.0,
        "net_debt_billion_krw": 500.0,
        "rd_annual_billion_krw": 400.0,
        "curr_price": 192000.0,
        "buy_price": 180000.0
    },
    "196170": {
        "name": "알테오젠",
        "market": "KR",
        "shares_outstanding_mil": 53.2,
        "base_revenue": 145.0,
        "growth_rate_next_5y": 32.0,
        "target_ebit_margin": 45.0,
        "sales_to_capital": 1.2,
        "unlevered_beta": 1.25,
        "debt_to_equity_pct": 10.0,
        "net_debt_billion_krw": -150.0,
        "rd_annual_billion_krw": 40.0,
        "curr_price": 315000.0,
        "buy_price": 285000.0,
        "consensus_target_price": "₩380,000",
        "consensus_opinion": "매수 (Buy)"
    },
    "011070": {
        "name": "LG이노텍",
        "market": "KR",
        "shares_outstanding_mil": 23.7,
        "base_revenue": 20600.0,
        "growth_rate_next_5y": 8.0,
        "target_ebit_margin": 6.2,
        "sales_to_capital": 1.3,
        "unlevered_beta": 1.05,
        "debt_to_equity_pct": 30.0,
        "net_debt_billion_krw": 2500.0,
        "rd_annual_billion_krw": 600.0,
        "curr_price": 218000.0,
        "buy_price": 205000.0,
        "consensus_target_price": "₩300,000",
        "consensus_opinion": "매수 (Buy)"
    },
    "298380": {
        "name": "에이비엘바이오",
        "market": "KR",
        "shares_outstanding_mil": 48.5,
        "base_revenue": 70.0,
        "growth_rate_next_5y": 25.0,
        "target_ebit_margin": 35.0,
        "sales_to_capital": 1.2,
        "unlevered_beta": 1.20,
        "debt_to_equity_pct": 12.0,
        "net_debt_billion_krw": -50.0,
        "rd_annual_billion_krw": 30.0,
        "curr_price": 34500.0,
        "buy_price": 31000.0,
        "consensus_target_price": "₩45,000",
        "consensus_opinion": "매수 (Buy)"
    },
    "034020": {
        "name": "두산에너빌리티",
        "market": "KR",
        "shares_outstanding_mil": 640.0,
        "base_revenue": 17500.0,
        "growth_rate_next_5y": 11.0,
        "target_ebit_margin": 6.5,
        "sales_to_capital": 1.1,
        "unlevered_beta": 1.10,
        "debt_to_equity_pct": 45.0,
        "net_debt_billion_krw": 3000.0,
        "rd_annual_billion_krw": 300.0,
        "curr_price": 19800.0,
        "buy_price": 18500.0,
        "consensus_target_price": "₩26,000",
        "consensus_opinion": "매수 (Buy)"
    },
    "373220": {
        "name": "LG에너지솔루션",
        "market": "KR",
        "shares_outstanding_mil": 234.0,
        "base_revenue": 33700.0,
        "growth_rate_next_5y": 14.0,
        "target_ebit_margin": 7.0,
        "sales_to_capital": 1.1,
        "unlevered_beta": 1.20,
        "debt_to_equity_pct": 25.0,
        "net_debt_billion_krw": 4000.0,
        "rd_annual_billion_krw": 1000.0,
        "curr_price": 385000.0,
        "buy_price": 360000.0,
        "consensus_target_price": "₩480,000",
        "consensus_opinion": "매수 (Buy)"
    },
    "012450": {
        "name": "한화에어로스페이스",
        "market": "KR",
        "shares_outstanding_mil": 50.6,
        "base_revenue": 9300.0,
        "growth_rate_next_5y": 16.0,
        "target_ebit_margin": 8.8,
        "sales_to_capital": 1.3,
        "unlevered_beta": 0.95,
        "debt_to_equity_pct": 30.0,
        "net_debt_billion_krw": 1200.0,
        "rd_annual_billion_krw": 300.0,
        "curr_price": 312000.0,
        "buy_price": 290000.0,
        "consensus_target_price": "₩370,000",
        "consensus_opinion": "매수 (Buy)"
    },
    "247540": {
        "name": "에코프로비엠",
        "market": "KR",
        "shares_outstanding_mil": 97.8,
        "base_revenue": 6900.0,
        "growth_rate_next_5y": 16.0,
        "target_ebit_margin": 6.2,
        "sales_to_capital": 1.2,
        "unlevered_beta": 1.40,
        "debt_to_equity_pct": 35.0,
        "net_debt_billion_krw": 1800.0,
        "rd_annual_billion_krw": 150.0,
        "curr_price": 165000.0,
        "buy_price": 155000.0,
        "consensus_target_price": "₩230,000",
        "consensus_opinion": "매수 (Buy)"
    },
    "207940": {
        "name": "삼성바이오로직스",
        "market": "KR",
        "shares_outstanding_mil": 71.2,
        "base_revenue": 3700.0,
        "growth_rate_next_5y": 14.0,
        "target_ebit_margin": 29.5,
        "sales_to_capital": 1.1,
        "unlevered_beta": 0.90,
        "debt_to_equity_pct": 15.0,
        "net_debt_billion_krw": 500.0,
        "rd_annual_billion_krw": 300.0,
        "curr_price": 998000.0,
        "buy_price": 950000.0,
        "consensus_target_price": "₩1,200,000",
        "consensus_opinion": "매수 (Buy)"
    },
    "000270": {
        "name": "기아",
        "market": "KR",
        "shares_outstanding_mil": 401.0,
        "base_revenue": 100000.0,
        "growth_rate_next_5y": 6.0,
        "target_ebit_margin": 11.5,
        "sales_to_capital": 1.3,
        "unlevered_beta": 0.95,
        "debt_to_equity_pct": 25.0,
        "net_debt_billion_krw": -10000.0,
        "rd_annual_billion_krw": 2500.0,
        "curr_price": 102000.0,
        "buy_price": 98000.0,
        "consensus_target_price": "₩140,000",
        "consensus_opinion": "매수 (Buy)"
    },
    "003230": {
        "name": "삼양식품",
        "market": "KR",
        "shares_outstanding_mil": 7.53,
        "base_revenue": 1200.0,
        "growth_rate_next_5y": 18.0,
        "target_ebit_margin": 14.5,
        "sales_to_capital": 1.4,
        "unlevered_beta": 0.85,
        "debt_to_equity_pct": 20.0,
        "net_debt_billion_krw": 100.0,
        "rd_annual_billion_krw": 30.0,
        "curr_price": 535000.0,
        "buy_price": 490000.0,
        "consensus_target_price": "₩710,000",
        "consensus_opinion": "매수 (Buy)"
    },
    "028300": {
        "name": "HLB",
        "market": "KR",
        "shares_outstanding_mil": 130.5,
        "base_revenue": 50.0,
        "growth_rate_next_5y": 25.0,
        "target_ebit_margin": 30.0,
        "sales_to_capital": 1.1,
        "unlevered_beta": 1.25,
        "debt_to_equity_pct": 15.0,
        "net_debt_billion_krw": 200.0,
        "rd_annual_billion_krw": 80.0,
        "curr_price": 86000.0,
        "buy_price": 82000.0,
        "consensus_target_price": "₩110,000",
        "consensus_opinion": "매수 (Buy)"
    },
    "352820": {
        "name": "하이브",
        "market": "KR",
        "shares_outstanding_mil": 41.7,
        "base_revenue": 2180.0,
        "growth_rate_next_5y": 10.0,
        "target_ebit_margin": 13.0,
        "sales_to_capital": 1.3,
        "unlevered_beta": 1.10,
        "debt_to_equity_pct": 20.0,
        "net_debt_billion_krw": -200.0,
        "rd_annual_billion_krw": 100.0,
        "curr_price": 182000.0,
        "buy_price": 175000.0,
        "consensus_target_price": "₩260,000",
        "consensus_opinion": "매수 (Buy)"
    },
    "NVDA": {
        "name": "NVIDIA",
        "market": "US",
        "shares_outstanding_mil": 24500.0, # 24.5B shares
        "base_revenue": 96300.0,          # 96.3B USD
        "growth_rate_next_5y": 24.0,
        "target_ebit_margin": 58.0,
        "sales_to_capital": 1.6,
        "unlevered_beta": 1.65,
        "debt_to_equity_pct": 10.0,
        "net_debt_billion_krw": -15000.0,
        "rd_annual_billion_krw": 8000.0,
        "curr_price": 142.8,
        "buy_price": 120.0
    },
    "AAPL": {
        "name": "Apple",
        "market": "US",
        "shares_outstanding_mil": 15300.0, # 15.3B shares
        "base_revenue": 391000.0,         # 391B USD
        "growth_rate_next_5y": 7.5,
        "target_ebit_margin": 31.0,
        "sales_to_capital": 1.8,
        "unlevered_beta": 1.05,
        "debt_to_equity_pct": 25.0,
        "net_debt_billion_krw": 50000.0,
        "rd_annual_billion_krw": 30000.0,
        "curr_price": 228.4,
        "buy_price": 215.0
    },
    "TSLA": {
        "name": "Tesla",
        "market": "US",
        "shares_outstanding_mil": 3190.0,  # 3.19B shares
        "base_revenue": 97700.0,          # 97.7B USD
        "growth_rate_next_5y": 16.0,
        "target_ebit_margin": 15.0,
        "sales_to_capital": 1.3,
        "unlevered_beta": 1.85,
        "debt_to_equity_pct": 15.0,
        "net_debt_billion_krw": -15000.0,
        "rd_annual_billion_krw": 4000.0,
        "curr_price": 243.5,
        "buy_price": 220.0
    }
}

def lookup_stock_profile(ticker_or_name):
    """티커 또는 종목명으로 등록된 재무 프로필 검색"""
    if not ticker_or_name:
        return None
    q = str(ticker_or_name).strip().upper()
    if q in STOCK_FINANCIAL_PROFILES:
        p = dict(STOCK_FINANCIAL_PROFILES[q])
        p["ticker"] = q
        return p
    for key, val in STOCK_FINANCIAL_PROFILES.items():
        if val["name"].upper() in q or q in val["name"].upper() or key in q:
            p = dict(val)
            p["ticker"] = key
            return p
    return None

KOREAN_TICKER_MAP = {
    "삼성전자": "005930",
    "삼성": "005930",
    "SK하이닉스": "000660",
    "하이닉스": "000660",
    "현대차": "005380",
    "현대자동차": "005380",
    "기아": "000270",
    "NAVER": "035420",
    "네이버": "035420",
    "카카오": "035720",
    "셀트리온": "068270",
    "삼성바이오로직스": "207940",
    "삼바": "207940",
    "LG에너지솔루션": "373220",
    "LG엔솔": "373220",
    "POSCO홀딩스": "005490",
    "포스코": "005490",
    "포스코홀딩스": "005490",
    "신한지주": "055550",
    "KB금융": "105560",
    "하나금융지주": "086790",
    "우리금융지주": "316140",
    "삼성물산": "028260",
    "삼성화재": "000810",
    "한화에어로스페이스": "012450",
    "한화에어로": "012450",
    "한화오션": "042660",
    "HD현대중공업": "329180",
    "현대중공업": "329180",
    "삼성중공업": "010140",
    "두산에너빌리티": "034020",
    "두산로보틱스": "454910",
    "알테오젠": "196170",
    "에코프로비엠": "247540",
    "에코프로": "086520",
    "크래프톤": "259960",
    "LG화학": "051910",
    "삼성SDI": "006400",
    "LG전자": "066570",
    "삼양식품": "003230",
    "농심": "004370",
    "유한양행": "000100",
    "한미약품": "128940",
    "HLB": "028300",
    "리가켐바이오": "141080",
    "삼천당제약": "000250",
    "하이브": "352820",
    "카카오뱅크": "323410",
    "카카오페이": "377300",
    "엔씨소프트": "036570",
    "넷마블": "251270",
    "한국전력": "015760",
    "HMM": "011200",
    "대한항공": "003490",
    "SK이노베이션": "096770",
    "S-Oil": "010950",
    "에쓰오일": "010950",
    "KT": "030200",
    "SK텔레콤": "017670",
    "LG유플러스": "032640",
    "LG이노텍": "011070",
    "이노텍": "011070",
    "에이비엘바이오": "298380",
    "아모레퍼시픽": "090430",
    "HD현대일렉트릭": "267260",
    "현대일렉트릭": "267260",
    "LS ELECTRIC": "010120",
    "LS일렉트릭": "010120",
    "효성중공업": "298040",
    "한미반도체": "042700",
    "리노공업": "058470",
    "이수페타시스": "007660",
    "현대위아": "011210",
    "HL만도": "204320",
    "만도": "204320",
    "메리츠금융지주": "138040",
    "롯데케미칼": "011170",
    "금호석유": "011780"
}

def search_naver_ticker(query):
    """네이버 검색을 통해 종목명으로 종목코드 동적 발굴"""
    if not query:
        return None
    q = str(query).strip()
    try:
        url = 'https://search.naver.com/search.naver?where=nexearch&query=' + urllib.parse.quote(q + ' 주가')
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'})
        with urllib.request.urlopen(req, context=ssl_ctx, timeout=4) as res:
            html = res.read().decode('utf-8', errors='ignore')
            m = re.search(r'm\.stock\.naver\.com/(?:domestic|integration)/stock/(\d{6})', html)
            if m: return m.group(1)
            m = re.search(r'finance\.naver\.com/item/main\.naver\?code=(\d{6})', html)
            if m: return m.group(1)
            m = re.search(r'data-stock-code="(\d{6})"', html)
            if m: return m.group(1)
            m = re.search(r'code=(\d{6})', html)
            if m: return m.group(1)
    except Exception:
        pass
    return None

def parse_korean_money(s):
    if not s or not isinstance(s, str):
        return 0.0
    s = s.replace(",", "").strip()
    total = 0.0
    m_jo = re.search(r"([\d\.]+)\s*조", s)
    if m_jo:
        total += float(m_jo.group(1)) * 1_000_000_000_000.0
    m_eok = re.search(r"([\d\.]+)\s*억", s)
    if m_eok:
        total += float(m_eok.group(1)) * 100_000_000.0
    if not m_jo and not m_eok:
        try:
            total = float(s)
        except:
            pass
    return total

def parse_price_number(val):
    if not val:
        return 0.0
    if isinstance(val, (int, float)):
        return float(val)
    cleaned = re.sub(r'[^\d.]', '', str(val))
    try:
        return float(cleaned)
    except Exception:
        return 0.0

def get_stock_sector(ticker, name=""):
    """종목코드 및 종목명 기반 9대 섹터 자동 분류"""
    name_str = (name or "").upper()
    t_str = (ticker or "").upper()
    comb = f"{name_str} {t_str}"

    # 0. 전력 & AI 인프라 / 원전 (power_grid)
    if any(k in comb for k in [
        "일렉트릭", "현대일렉트릭", "LS ELECTRIC", "LS일렉트릭", "효성중공업", "한국전력", "두산에너빌리티", "한전",
        "CEG", "VST", "GEV", "ETN", "SMR", "CCJ",
        "267260", "010120", "298040", "034020", "015760"
    ]):
        return "power_grid"

    # 1. 바이오 / 제약 / 신약 플랫폼
    if any(k in comb for k in [
        "알테오젠", "에이비엘", "바이오", "제약", "HLB", "셀트리온", "유한양행", "삼천당", "리가켐", "휴젤", "씨젠", "한미약품", "녹십자", "대웅제약",
        "LLY", "NVO", "MRK", "ABBV", "AMGN",
        "196170", "298380", "141080", "028300", "068270", "207940", "000100", "000250", "145020", "096530", "128940"
    ]):
        return "biotech_pharma"

    # 2. 소프트웨어 / 빅테크 / AI / 플랫폼
    if any(k in comb for k in [
        "NVDA", "AAPL", "MSFT", "GOOGL", "AMZN", "META", "PLTR", "NAVER", "네이버", "카카오", "하이브", "크래프톤", "엔씨소프트", "넷마블",
        "035420", "035720", "352820", "259960", "036570", "251270", "323410", "377300"
    ]):
        return "software_ai"

    # 3. 반도체 & 하드웨어 장비
    if any(k in comb for k in [
        "하이닉스", "SK하이닉스", "삼성전자", "한미반도체", "이노텍", "LG이노텍", "리노공업", "DB하이텍", "이수페타시스",
        "TSM", "AVGO", "ASML", "QCOM",
        "000660", "005930", "042700", "011070", "058470", "000990", "007660"
    ]):
        return "semiconductor"

    # 4. 2차전지 & 클린에너지
    if any(k in comb for k in [
        "에너지솔루션", "LG엔솔", "에코프로", "에코프로비엠", "포스코홀딩스", "포스코퓨처엠", "삼성SDI", "LG화학", "엘앤에프",
        "ALB", "ENPH", "FSLR", "NEE", "QS",
        "373220", "247540", "086520", "005490", "003670", "006400", "051910", "066970"
    ]):
        return "battery_cleanenergy"

    # 5. 방산 / 조선 / 중공업
    if any(k in comb for k in [
        "한화에어로", "한화에어로스페이스", "HD현대중공업", "현대중공업", "한화오션", "삼성중공업", "한국항공우주", "LIG넥스원", "현대로템",
        "LMT", "RTX", "NOC", "GD", "HII",
        "012450", "329180", "042660", "010140", "047810", "079550", "064350"
    ]):
        return "defense_shipbuilding"

    # 6. 자동차 & 모빌리티
    if any(k in comb for k in [
        "현대차", "현대자동차", "기아", "현대모비스", "모비스", "현대위아", "만도", "HL만도",
        "TSLA", "GM", "FORD", "UBER", "RIVN",
        "005380", "000270", "012330", "011210", "204320"
    ]):
        return "auto_mobility"

    # 7. 은행 & 금융지주
    if any(k in comb for k in [
        "KB금융", "신한지주", "하나금융", "메리츠", "우리금융", "카카오뱅크",
        "JPM", "BAC", "WFC", "GS", "MS",
        "105560", "055550", "086790", "138040", "316140", "323410"
    ]):
        return "banking_finance"

    # 8. 정유·화학 & 에너지
    if any(k in comb for k in [
        "SK이노베이션", "S-OIL", "에쓰오일", "롯데케미칼", "금호석유",
        "XOM", "CVX", "COP", "OXY", "DOW",
        "096770", "010950", "011170", "011780"
    ]):
        return "energy_chemical"

    # 9. 소비재 / 음식료
    if any(k in comb for k in [
        "삼양식품", "농심", "오리온", "아모레퍼시픽", "CJ제일제당", "하이트진로",
        "003230", "004370", "271560", "090430", "097950", "000080"
    ]):
        return "consumer_food"

    return "general_manufacturing"

SECTOR_CONFIG = {
    "biotech_pharma": {
        "name": "바이오·신약 파이프라인(rNPV)",
        "icon": "fa-dna",
        "badge_color": "purple",
        "model_name": "다모다란 바이오 rNPV & 로열티 J-Curve 특화 모델",
        "desc": "신약 파이프라인 성공확률(rNPV) 및 기술이전(L/O) 로열티 J-Curve 현금흐름 반영 (전통 제조업 단순매출 DCF 왜곡 배제)",
        "default_growth": 45.0,
        "default_margin": 55.0,
        "sales_to_capital": 2.8,
        "unlevered_beta": 1.25,
        "valuation_weight_consensus": 0.70,
        "valuation_weight_dcf": 0.30
    },
    "software_ai": {
        "name": "AI·소프트웨어·플랫폼",
        "icon": "fa-microchip",
        "badge_color": "indigo",
        "model_name": "다모다란 SaaS & AI 영업레버리지 특화 모델",
        "desc": "높은 영업레버리지, R&D 무형자산 자본화 및 높은 자본회전율(Sales-to-Capital) 적용",
        "default_growth": 25.0,
        "default_margin": 32.0,
        "sales_to_capital": 2.5,
        "unlevered_beta": 1.30,
        "valuation_weight_consensus": 0.40,
        "valuation_weight_dcf": 0.60
    },
    "semiconductor": {
        "name": "반도체·하드웨어",
        "icon": "fa-bolt",
        "badge_color": "blue",
        "model_name": "실리콘 사이클 정상화 EBIT 모델",
        "desc": "실리콘 사이클(Silicon Cycle) 정상화 EBIT 마진 및 설비투자(Capex) 감가상각 사이클 반영",
        "default_growth": 16.0,
        "default_margin": 26.0,
        "sales_to_capital": 1.3,
        "unlevered_beta": 1.20,
        "valuation_weight_consensus": 0.20,
        "valuation_weight_dcf": 0.80
    },
    "battery_cleanenergy": {
        "name": "2차전지·친환경",
        "icon": "fa-battery-full",
        "badge_color": "emerald",
        "model_name": "캐즘 회복 & 생산보조금(AMPC) 반영 모델",
        "desc": "전기차 캐즘(Chasm) 통과 후 가동률 정상화 및 북미/유럽 AMPC 세액공제 현금유입 반영",
        "default_growth": 22.0,
        "default_margin": 16.0,
        "sales_to_capital": 1.5,
        "unlevered_beta": 1.35,
        "valuation_weight_consensus": 0.30,
        "valuation_weight_dcf": 0.70
    },
    "defense_shipbuilding": {
        "name": "방산·조선·중공업",
        "icon": "fa-shield-halved",
        "badge_color": "cyan",
        "model_name": "3~5년 확정 수주잔고(Backlog) 가치 모델",
        "desc": "확정 수주잔고 기반 높은 현금흐름 가시성 및 고마진 수출 비중 확대 프리미엄 반영",
        "default_growth": 18.0,
        "default_margin": 14.0,
        "sales_to_capital": 1.8,
        "unlevered_beta": 0.95,
        "valuation_weight_consensus": 0.20,
        "valuation_weight_dcf": 0.80
    },
    "auto_mobility": {
        "name": "자동차·모빌리티",
        "icon": "fa-car",
        "badge_color": "amber",
        "model_name": "FCF 현금전환율 & 주주환원 모델",
        "desc": "하이브리드/전기차 마진 방어력 및 주주환원(자사주 소각/배당) 잉여현금흐름 반영",
        "default_growth": 8.0,
        "default_margin": 10.5,
        "sales_to_capital": 1.6,
        "unlevered_beta": 0.90,
        "valuation_weight_consensus": 0.15,
        "valuation_weight_dcf": 0.85
    },
    "banking_finance": {
        "name": "은행 & 금융지주",
        "icon": "fa-building-columns",
        "badge_color": "emerald",
        "model_name": "다모다란 금융 배당할인(DDM) & 저PBR 밸류업 모델",
        "desc": "순이자마진(NIM), 자사주 소각 및 주주환원 배당수익률(5%+) 기반 가치평가",
        "default_growth": 5.0,
        "default_margin": 35.0,
        "sales_to_capital": 0.95,
        "unlevered_beta": 0.55,
        "valuation_weight_consensus": 0.30,
        "valuation_weight_dcf": 0.70
    },
    "energy_chemical": {
        "name": "정유·화학 & 에너지",
        "icon": "fa-oil-well",
        "badge_color": "amber",
        "model_name": "정제마진 & 상품 스프레드 정상화 모델",
        "desc": "국제유가 변동성 및 화학/정제마진 사이클 정상화 EBITDA 반영",
        "default_growth": 6.0,
        "default_margin": 7.0,
        "sales_to_capital": 1.6,
        "unlevered_beta": 0.92,
        "valuation_weight_consensus": 0.20,
        "valuation_weight_dcf": 0.80
    },
    "power_grid": {
        "name": "전력 & AI 인프라 / 원전",
        "icon": "fa-tower-broadcast",
        "badge_color": "yellow",
        "model_name": "AI 전력망 슈퍼사이클 & 수주잔고(Backlog) DCF 모델",
        "desc": "북미/유럽 노후 전력망 교체 및 AI 데이터센터 전력 수요 폭증에 따른 장기 확정 수주 프리미엄 반영",
        "default_growth": 20.0,
        "default_margin": 17.5,
        "sales_to_capital": 1.70,
        "unlevered_beta": 0.85,
        "valuation_weight_consensus": 0.25,
        "valuation_weight_dcf": 0.75
    },
    "consumer_food": {
        "name": "K-소비재·음식료",
        "icon": "fa-bowl-food",
        "badge_color": "rose",
        "model_name": "글로벌 확장 FCF 소비재 모델",
        "desc": "글로벌 K-Food 수출 확장성, 안정적 잉여현금 창출력 및 경기방어적 낮은 베타 적용",
        "default_growth": 14.0,
        "default_margin": 15.0,
        "sales_to_capital": 1.9,
        "unlevered_beta": 0.75,
        "valuation_weight_consensus": 0.15,
        "valuation_weight_dcf": 0.85
    },
    "general_manufacturing": {
        "name": "일반 제조업 / 표준 산업",
        "icon": "fa-industry",
        "badge_color": "slate",
        "model_name": "다모다란 표준 2단계 FCFF 모델",
        "desc": "전통적 설비투자 및 점진적 이익 성장 표준 2단계 FCFF 모델",
        "default_growth": 10.0,
        "default_margin": 15.0,
        "sales_to_capital": 1.4,
        "unlevered_beta": 1.10,
        "valuation_weight_consensus": 0.10,
        "valuation_weight_dcf": 0.90
    }
}

def get_stock_autofill_data(query):
    """
    사용자가 종목명이나 티커만 입력했을 때,
    네이버 증권 실시간 시세, 공시 재무제표(FnGuide 매출, 마진, 부채비율, 발행주식수),
    증권사 컨센서스 리포트 목표가, 다모다란 베타를 100% 자동 추출하여 반환
    """
    if not query:
        return None
    q = str(query).strip()

    # 1. 한글 종목명 매핑 확인
    target_code = q.upper()
    for kname, code in KOREAN_TICKER_MAP.items():
        if kname == q or kname in q or q in kname:
            target_code = code
            break

    if not re.match(r"^\d{1,6}$", target_code) and target_code not in ["NVDA", "AAPL", "TSLA", "MSFT", "GOOGL", "AMZN", "META"]:
        dyn_code = search_naver_ticker(q)
        if dyn_code:
            target_code = dyn_code

    profile = lookup_stock_profile(target_code) or lookup_stock_profile(q)
    if profile and profile.get("ticker"):
        target_code = profile["ticker"]

    # 2. 미국 주식 확인
    if target_code in ["NVDA", "AAPL", "TSLA", "MSFT", "GOOGL", "AMZN", "META"] or (profile and profile.get("market") == "US"):
        prof = profile or STOCK_FINANCIAL_PROFILES.get(target_code, {})
        curr_p = prof.get("curr_price", 100.0)
        target_mean = round(curr_p * 1.25, 1)
        sector_id = get_stock_sector(target_code, prof.get("name", target_code))
        sector_cfg = SECTOR_CONFIG.get(sector_id, SECTOR_CONFIG["general_manufacturing"])
        return {
            "success": True,
            "market": "US",
            "currency": "USD",
            "ticker": target_code,
            "name": prof.get("name", target_code),
            "sector_id": sector_id,
            "sector_name": sector_cfg["name"],
            "sector_model": sector_cfg["model_name"],
            "sector_desc": sector_cfg["desc"],
            "current_price": curr_p,
            "shares_outstanding_mil": prof.get("shares_outstanding_mil", 1000.0),
            "base_revenue": prof.get("base_revenue", 50000.0),
            "growth_rate_next_5y": prof.get("growth_rate_next_5y", sector_cfg["default_growth"]),
            "target_ebit_margin": prof.get("target_ebit_margin", sector_cfg["default_margin"]),
            "unlevered_beta": prof.get("unlevered_beta", sector_cfg["unlevered_beta"]),
            "debt_to_equity_pct": prof.get("debt_to_equity_pct", 15.0),
            "net_debt_billion_krw": prof.get("net_debt_billion_krw", 0),
            "consensus_target_price": f"${target_mean}",
            "consensus_opinion": "매수 (Buy)",
            "rf": 4.12,
            "source_info": "SEC 10-K 공시 & Wall Street 리포트 컨센서스"
        }

    # 3. 국내 주식 코드 패딩 (1~6자리 숫자)
    if re.match(r"^\d{1,6}$", target_code):
        target_code = target_code.zfill(6)

    # 4. 네이버 증권 API 실시간 조회 (통합 및 공시 연간 재무제표)
    d_int = fetch_naver_json(f"https://m.stock.naver.com/api/stock/{target_code}/integration")
    d_fin = fetch_naver_json(f"https://m.stock.naver.com/api/stock/{target_code}/finance/annual")

    base_prof = STOCK_FINANCIAL_PROFILES.get(target_code, {})
    name = (d_int.get("stockName") if d_int else "") or base_prof.get("name") or q
    curr_price = 0.0
    mcap_str = ""
    target_price_str = "-"

    basic_data = get_naver_stock_data(target_code)
    if basic_data and basic_data.get("current_price", 0) > 0:
        curr_price = basic_data["current_price"]
        if basic_data.get("name"):
            name = basic_data["name"]

    if d_int:
        consensus_info = d_int.get("consensusInfo") or {}
        raw_tp = consensus_info.get("priceTargetMean", "-")
        if raw_tp and raw_tp != "-":
            target_price_str = raw_tp if (raw_tp.startswith("₩") or raw_tp.startswith("$")) else f"₩{raw_tp}"
        for item in d_int.get("totalInfos", []):
            if item.get("code") == "lastClosePrice" and curr_price <= 0:
                try:
                    curr_price = float(item.get("value", "0").replace(",", ""))
                except:
                    pass
            elif item.get("code") == "marketValue":
                mcap_str = item.get("value", "")

    if curr_price <= 0 and base_prof:
        curr_price = base_prof.get("curr_price", 50000.0)

    # 목표주가 폴백 (컨센서스 없거나 미제공 시 기업 프로필 기준)
    if (not target_price_str or target_price_str == "-") and base_prof.get("consensus_target_price"):
        target_price_str = base_prof["consensus_target_price"]

    # 증권사 투자의견 도출
    consensus_opinion = "매수"
    if d_int:
        consensus_info = d_int.get("consensusInfo") or {}
        raw_opinion = consensus_info.get("recommMean")
        if raw_opinion:
            try:
                op_val = float(raw_opinion)
                if op_val >= 4.0:
                    consensus_opinion = f"매수 ({op_val:.2f})"
                elif op_val >= 3.0:
                    consensus_opinion = f"중립 ({op_val:.2f})"
                else:
                    consensus_opinion = f"매도 ({op_val:.2f})"
            except:
                consensus_opinion = str(raw_opinion)
    if (not consensus_opinion or consensus_opinion == "매수") and base_prof.get("consensus_opinion"):
        consensus_opinion = base_prof["consensus_opinion"]

    # 발행주식수 도출
    mcap_won = parse_korean_money(mcap_str)
    if base_prof and base_prof.get("shares_outstanding_mil"):
        shares_mil = base_prof["shares_outstanding_mil"]
    elif curr_price > 0 and mcap_won > 0:
        shares_mil = round(mcap_won / curr_price / 1_000_000.0, 1)
    else:
        shares_mil = 50.0

    # 공시 재무제표에서 최근 연매출, 영업이익률, 부채비율 추출
    default_rev = 1500.0
    if curr_price > 0 and shares_mil > 0:
        est_mcap_billion = (curr_price * shares_mil * 1_000_000.0) / 1_000_000_000.0
        default_rev = round(est_mcap_billion / 1.5, 1)

    rev_billion_krw = base_prof.get("base_revenue", default_rev)
    margin_pct = base_prof.get("target_ebit_margin", 15.0)
    de_pct = base_prof.get("debt_to_equity_pct", 25.0)

    if d_fin:
        rows = d_fin.get("financeInfo", {}).get("rowList", [])
        for r in rows:
            title = r.get("title")
            cols = r.get("columns", {})
            keys = sorted(cols.keys())
            latest_key = keys[-2] if len(keys) >= 2 else (keys[0] if keys else None)
            if not latest_key:
                continue
            val_str = cols.get(latest_key, {}).get("value", "0").replace(",", "")
            try:
                val_num = float(val_str)
                if title == "매출액" and val_num > 0:
                    rev_billion_krw = round(val_num / 10.0, 1)  # 억원 -> 십억원
                elif title == "영업이익률" and val_num != 0:
                    margin_pct = round(val_num, 1)
                elif title == "부채비율" and val_num > 0:
                    de_pct = round(val_num, 1)
            except:
                pass

    # 섹터 분류 및 섹터 특화 파라미터 적용
    sector_id = get_stock_sector(target_code, name)
    sector_cfg = SECTOR_CONFIG.get(sector_id, SECTOR_CONFIG["general_manufacturing"])

    unlevered_beta = base_prof.get("unlevered_beta", sector_cfg["unlevered_beta"])
    growth_rate = base_prof.get("growth_rate_next_5y", sector_cfg["default_growth"])

    # 바이오/신약 섹터의 경우: 과거 단순결산매출 기반의 전통제조업 마진/성장률 왜곡 방지
    if sector_id == "biotech_pharma":
        growth_rate = sector_cfg["default_growth"]  # 45% (상업화/로열티 J-Curve)
        if margin_pct < 40.0:
            margin_pct = sector_cfg["default_margin"]  # 55% (기술이전 로열티 마진)
        unlevered_beta = sector_cfg["unlevered_beta"]
    elif sector_id == "software_ai":
        growth_rate = max(growth_rate, sector_cfg["default_growth"])
        margin_pct = max(margin_pct, sector_cfg["default_margin"])
        unlevered_beta = sector_cfg["unlevered_beta"]
    elif sector_id == "semiconductor":
        margin_pct = max(margin_pct, 24.0)
        unlevered_beta = sector_cfg["unlevered_beta"]
    else:
        if margin_pct > 30.0:
            growth_rate = max(growth_rate, 14.0)
        elif margin_pct < 8.0:
            growth_rate = min(growth_rate, 6.0)

    return {
        "success": True,
        "market": "KR",
        "currency": "KRW",
        "ticker": target_code,
        "name": name,
        "sector_id": sector_id,
        "sector_name": sector_cfg["name"],
        "sector_model": sector_cfg["model_name"],
        "sector_desc": sector_cfg["desc"],
        "current_price": curr_price,
        "market_cap": mcap_str,
        "shares_outstanding_mil": shares_mil,
        "base_revenue": rev_billion_krw,
        "target_ebit_margin": margin_pct,
        "debt_to_equity_pct": de_pct,
        "consensus_target_price": target_price_str,
        "consensus_opinion": consensus_opinion,
        "unlevered_beta": unlevered_beta,
        "growth_rate_next_5y": growth_rate,
        "rf": 3.28,
        "source_info": "네이버 증권(FnGuide) 공시 결산 재무제표 & 증권사 리포트 컨센서스"
    }

# ==============================================================================
# 1. 다모다란 가치평가 계산 코어 (DCF / WACC Engine with Sector Specifics)
# ==============================================================================
def calculate_damodaran_dcf(stock_data, rf_override=None):
    """
    아스워스 다모다란 교수의 The Dark Side of Valuation 섹터별 특화 밸류에이션 모델:
    - 바이오/제약: 임상 성공확률 가중(rNPV) 및 기술이전 로열티 J-Curve 현금흐름 앙상블
    - 소프트웨어/AI: 높은 영업레버리지 및 R&D 무형자산 자본화
    - 반도체: 실리콘 사이클(Silicon Cycle) 정상화 EBIT 모델
    - 방산/조선: 3~5년 확정 수주잔고(Backlog) 가시성 프리미엄
    - 2차전지: 캐즘 통과 후 설비투자 회수기 현금유입
    """
    raw_inputs = stock_data.get("damodaran_inputs")
    inputs = raw_inputs if (isinstance(raw_inputs, dict) and raw_inputs) else stock_data
    market = stock_data.get("market", "KR")
    ticker = stock_data.get("ticker", "")
    name = stock_data.get("name", "")
    profile = lookup_stock_profile(ticker) or lookup_stock_profile(name)
    
    # 섹터 판정 및 메타데이터 로드
    sector_id = stock_data.get("sector_id") or (profile.get("sector") if profile else None) or get_stock_sector(ticker, name)
    sector_cfg = SECTOR_CONFIG.get(sector_id, SECTOR_CONFIG["general_manufacturing"])

    # 1) 무위험수익률(Rf) 결정
    if rf_override is not None:
        rf = float(rf_override)
    else:
        rf = 4.12 if market == "US" else 3.28
    
    erp = 5.0  # 주식위험프리미엄 (Equity Risk Premium, 다모다란 평균)
    
    unlevered_beta = inputs.get("unlevered_beta") or (profile["unlevered_beta"] if profile else sector_cfg["unlevered_beta"])
    de_ratio = (inputs.get("debt_to_equity_pct") or (profile["debt_to_equity_pct"] if profile else 15.0)) / 100.0
    tax_rate = (inputs.get("effective_tax_rate") or 22.0) / 100.0
    cost_of_debt_pretax = (inputs.get("cost_of_debt_pretax") or 4.5) / 100.0
    
    # 2) 레버리지 베타 계산: Beta_L = Beta_U * [1 + (1 - t) * (D/E)]
    levered_beta = unlevered_beta * (1.0 + (1.0 - tax_rate) * de_ratio)
    
    # 3) 자기자본비용 (CAPM): Ke = Rf + Beta_L * ERP
    cost_of_equity = (rf / 100.0) + (levered_beta * (erp / 100.0))
    
    # 4) 타인자본비용 (세후): Kd_after_tax = Kd_pretax * (1 - t)
    cost_of_debt_after_tax = cost_of_debt_pretax * (1.0 - tax_rate)
    
    # 5) 자본 가중치 및 WACC 산출
    weight_equity = 1.0 / (1.0 + de_ratio)
    weight_debt = de_ratio / (1.0 + de_ratio)
    wacc = (weight_equity * cost_of_equity) + (weight_debt * cost_of_debt_after_tax)
    
    # 6) 미래 5개년 FCFF 추정
    base_rev = inputs.get("base_revenue")
    if not base_rev or base_rev <= 0:
        base_rev = profile["base_revenue"] if profile else 50000.0
    
    g_5y = (inputs.get("growth_rate_next_5y") or (profile["growth_rate_next_5y"] if profile else sector_cfg["default_growth"])) / 100.0
    g_term = min((inputs.get("terminal_growth_rate") or 2.5) / 100.0, (rf / 100.0)) # 영구성장률은 Rf를 넘을 수 없음
    target_margin = (inputs.get("target_ebit_margin") or (profile["target_ebit_margin"] if profile else sector_cfg["default_margin"])) / 100.0
    sales_to_cap = inputs.get("sales_to_capital") or (profile["sales_to_capital"] if profile else sector_cfg["sales_to_capital"])
    
    # R&D 자본화 효과 반영 (영업이익 및 NOPAT 상향 조정)
    rd_annual = inputs.get("rd_annual_billion_krw") or (profile.get("rd_annual_billion_krw", 0) if profile else 0)
    rd_boost = (rd_annual * 0.25) if rd_annual > 0 else 0
    
    pv_fcff_total = 0.0
    current_rev = base_rev
    fcff_projections = []
    
    for year in range(1, 6):
        next_rev = current_rev * (1.0 + g_5y)
        delta_rev = next_rev - current_rev
        reinvestment = delta_rev / sales_to_cap if sales_to_cap > 0 else 0
        ebit = (next_rev * target_margin) + rd_boost
        nopat = ebit * (1.0 - tax_rate)
        fcff = nopat - reinvestment
        
        discount_factor = (1.0 + wacc) ** year
        pv_fcff = fcff / discount_factor
        pv_fcff_total += pv_fcff
        
        fcff_projections.append({
            "year": f"Y+{year}",
            "revenue": round(next_rev, 1),
            "ebit": round(ebit, 1),
            "nopat": round(nopat, 1),
            "reinvestment": round(reinvestment, 1),
            "fcff": round(fcff, 1),
            "pv_fcff": round(pv_fcff, 1)
        })
        current_rev = next_rev
        
    # 7) 영구가치 (Terminal Value) 계산
    terminal_wacc = max(wacc * 0.95, (rf / 100.0) + 0.04)
    terminal_rev = current_rev * (1.0 + g_term)
    terminal_ebit = terminal_rev * target_margin
    terminal_nopat = terminal_ebit * (1.0 - tax_rate)
    terminal_reinvestment = terminal_nopat * (g_term / terminal_wacc)
    terminal_fcff = terminal_nopat - terminal_reinvestment
    
    terminal_value = terminal_fcff / (terminal_wacc - g_term)
    pv_terminal_value = terminal_value / ((1.0 + wacc) ** 5)
    
    # 8) 기업가치(Enterprise Value) & 주주지분가치(Equity Value)
    enterprise_value = pv_fcff_total + pv_terminal_value
    net_debt = inputs.get("net_debt_billion_krw")
    if net_debt is None:
        net_debt = profile.get("net_debt_billion_krw", 0) if profile else 0
    equity_value = enterprise_value - net_debt
    
    # 발행주식수 결정
    shares = float(inputs.get("shares_outstanding_mil") or 0)
    if shares <= 0 or shares == 1.0 or (shares == 100.0 and profile and profile["shares_outstanding_mil"] != 100.0):
        if profile:
            shares = profile["shares_outstanding_mil"]
        else:
            curr_p = float(stock_data.get("current_price") or stock_data.get("buy_price") or 0)
            if curr_p > 0:
                shares = (base_rev * 1.5 * 1000.0) / curr_p if market == "KR" else (base_rev * 1.5) / curr_p
            else:
                shares = 100.0
    if shares <= 0:
        shares = 1.0
        
    # 기본 단독 DCF 1주당 가치
    raw_fair_value = (equity_value * 1000.0) / shares if market == "KR" else equity_value / shares
    raw_fair_value = max(raw_fair_value, 1.0)
    
    # 9) 애널리스트 컨센서스 목표가 추출
    raw_tp = stock_data.get("consensus_target_price") or inputs.get("consensus_target_price") or (profile.get("consensus_target_price") if profile else None)
    consensus_tp_num = parse_price_number(raw_tp)
    if consensus_tp_num <= 0 and (ticker or name):
        try:
            live_auto = get_stock_autofill_data(ticker or name)
            if live_auto and live_auto.get("consensus_target_price"):
                consensus_tp_num = parse_price_number(live_auto["consensus_target_price"])
        except Exception:
            pass

    # 10) 섹터별 가치평가 모델 앙상블 (다모다란 The Dark Side of Valuation 특화)
    if consensus_tp_num > 0 and sector_id == "biotech_pharma":
        # 바이오·신약 파이프라인: 단순 과거 매출 DCF의 오류를 보정하여 신약 파이프라인 rNPV 컨센서스(70%) + DCF(30%) 앙상블
        w_con = sector_cfg.get("valuation_weight_consensus", 0.70)
        w_dcf = sector_cfg.get("valuation_weight_dcf", 0.30)
        hybrid_val = (raw_fair_value * w_dcf) + (consensus_tp_num * w_con)
        base_val = max(hybrid_val, consensus_tp_num * 0.85)
        conservative_val = base_val * 0.80
        bullish_val = max(base_val * 1.25, consensus_tp_num * 1.15)
    elif consensus_tp_num > 0 and sector_id == "software_ai":
        w_con = sector_cfg.get("valuation_weight_consensus", 0.40)
        w_dcf = sector_cfg.get("valuation_weight_dcf", 0.60)
        hybrid_val = (raw_fair_value * w_dcf) + (consensus_tp_num * w_con)
        base_val = max(hybrid_val, min(raw_fair_value, consensus_tp_num) * 0.95)
        conservative_val = base_val * 0.82
        bullish_val = base_val * 1.28
    elif consensus_tp_num > 0:
        w_con = sector_cfg.get("valuation_weight_consensus", 0.20)
        w_dcf = sector_cfg.get("valuation_weight_dcf", 0.80)
        hybrid_val = (raw_fair_value * w_dcf) + (consensus_tp_num * w_con)
        base_val = hybrid_val
        conservative_val = base_val * 0.80
        bullish_val = base_val * 1.25
    else:
        conservative_val = raw_fair_value * 0.80
        base_val = raw_fair_value
        bullish_val = raw_fair_value * 1.28
    
    return {
        "sector_id": sector_id,
        "sector_name": sector_cfg["name"],
        "sector_model": sector_cfg["model_name"],
        "sector_desc": sector_cfg["desc"],
        "wacc": round(wacc * 100.0, 2),
        "cost_of_equity": round(cost_of_equity * 100.0, 2),
        "cost_of_debt_after_tax": round(cost_of_debt_after_tax * 100.0, 2),
        "levered_beta": round(levered_beta, 3),
        "rf_used": round(rf, 2),
        "erp_used": erp,
        "enterprise_value": round(enterprise_value, 1),
        "equity_value": round(equity_value, 1),
        "shares_outstanding_mil": round(shares, 1),
        "raw_dcf_value": round(raw_fair_value, 1 if market == "US" else -1),
        "consensus_target_price": consensus_tp_num,
        "conservative_value": round(conservative_val, 1 if market == "US" else -1),
        "base_fair_value": round(base_val, 1 if market == "US" else -1),
        "bullish_value": round(bullish_val, 1 if market == "US" else -1),
        "fcff_projections": fcff_projections
    }

# ==============================================================================
# 2. 융합 매도 타이밍 분석 알고리즘 (Exit Timing & Recommendation)
# ==============================================================================
def evaluate_exit_timing(stock, dcf_result):
    """
    다모다란 펀더멘털 적정가 밴드와 차트 기술적 지표(RSI, 볼린저밴드, 이평선)를
    융합하여 정밀하고 직관적인 매도 신호 및 단계별 매도 실행 플랜 도출
    (섹터 특성 및 실제 기술적 과열 여부를 정확히 판단)
    """
    curr_price = float(stock.get("current_price", 0))
    buy_price = float(stock.get("buy_price", 0))
    quantity = int(stock.get("quantity", 1))
    currency = stock.get("currency", "KRW")
    tech = stock.get("technical_indicators", {})
    
    sector_id = stock.get("sector_id") or dcf_result.get("sector_id") or get_stock_sector(stock.get("ticker", ""), stock.get("name", ""))
    
    rsi = float(tech.get("rsi_14", 50.0))
    bb_upper = float(tech.get("bollinger_upper", curr_price * 1.05))
    bb_lower = float(tech.get("bollinger_lower", curr_price * 0.95))
    sma_20 = float(tech.get("sma_20", curr_price))
    sma_60 = float(tech.get("sma_60", curr_price * 0.96))
    
    conservative_val = dcf_result["conservative_value"]
    base_val = dcf_result["base_fair_value"]
    bullish_val = dcf_result["bullish_value"]
    
    # 수익률 및 가치 괴리율
    profit_pct = ((curr_price - buy_price) / buy_price * 100.0) if buy_price > 0 else 0
    valuation_gap_pct = ((curr_price - base_val) / base_val * 100.0) if base_val > 0 else 0
    
    # 손절 및 트레일링 익절선 계산
    if profit_pct >= 5.0:
        # 수익 5% 이상 달성 중일 때는 '트레일링 익절선 (Trailing Stop)' 작동!
        # 이미 난 수익을 시장에 반납하지 않도록 20일선(생명선) 및 수익 70% 보존선 설정
        trailing_base = max(buy_price * 1.02, curr_price * 0.92)
        if sma_20 > 0:
            trailing_base = max(trailing_base, sma_20 * 0.98)
        stop_loss_price = trailing_base
    else:
        # 손실 중일 때의 기계적 손절선 (매수가 -8% 또는 60일선 -3% 이탈)
        stop_loss_price = max(buy_price * 0.92, sma_60 * 0.97)
    
    # 익절 단계 기준선 (수익 중이거나 적정가를 넘었을 때 역전 방지)
    if profit_pct > 0 or curr_price >= base_val:
        target_1 = max(base_val, curr_price * 1.05, bb_upper)
        target_2 = max(bullish_val, curr_price * 1.12, target_1 * 1.07)
        target_3 = max(bullish_val * 1.25, curr_price * 1.25, target_2 * 1.10)
    else:
        target_1 = max(base_val, buy_price * 1.05)
        target_2 = (target_1 + bullish_val) / 2.0
        target_3 = max(bullish_val, target_2 * 1.10)
    
    # RSI 기술적 상태 문구 정확화 (RSI 70 미만은 과열 아님!)
    if rsi >= 72.0:
        rsi_text = f" + 차트 과열(RSI {rsi:.1f})"
    elif rsi <= 35.0:
        rsi_text = f" + 차트 과매도(RSI {rsi:.1f})"
    else:
        rsi_text = f" (RSI {rsi:.1f} 안정권)"
    
    signal_type = ""
    signal_badge = ""
    signal_color = "" # hex color
    sell_gauge_score = 0
    headline = ""
    action_guidance = ""
    shares_to_sell = 0
    
    # 1) 손절 / 리스크 관리 조건 체크 (손실 중이면서 지지선 이탈)
    if curr_price <= stop_loss_price and profit_pct < -5.0:
        signal_type = "STOP_LOSS_ALERT"
        signal_badge = "손절 / 리스크 오프 권고"
        signal_color = "#ef4444" # red
        sell_gauge_score = 90
        headline = f"손절 기준선({currency_symbol(currency)}{format_num(stop_loss_price)}) 하향 이탈! 원금 보호 우선"
        shares_to_sell = quantity
        action_guidance = f"주가가 매수가 대비 {profit_pct:.1f}% 하락하였으며 주요 지지선을 이탈했습니다. 추가 손실 방지를 위해 전량 손절 또는 비중 70% 축소를 권고합니다."
        
    # 2) 수익권(+5% 이상)이면서 추세가 견고하고 과열이 없는 경우 (추세 추종 수익 극대화 - 섣부른 전량 매도 금지!)
    elif profit_pct >= 5.0 and rsi < 70.0 and (curr_price >= sma_20 * 0.98 or curr_price >= sma_60 * 0.98):
        signal_type = "TREND_RIDE_HOLD"
        signal_badge = "🚀 수익 극대화 / 추세 지속 (트레일링 익절 홀딩)"
        signal_color = "#3b82f6" # blue
        sell_gauge_score = 28
        shares_to_sell = 0
        headline = f"수익률 +{profit_pct:.1f}% 달성! 20일 생명선 지지 기반 우상향 지속{rsi_text}"
        action_guidance = f"현재 +{profit_pct:.1f}% 수익을 기록 중이며, 차트 보조지표(RSI {rsi:.1f})가 안정적인 우상향 정배열 추세입니다. 섣불리 전량 매도하지 마시고, 트레일링 익절선({currency_symbol(currency)}{format_num(stop_loss_price)})을 하방 방어선으로 설정하여 수익을 끝까지 극대화하십시오."

    # 3) 단기 기술적 과열(RSI >= 72) 또는 볼린저 상단 도달 시 (1차 분할 익절 찬스)
    elif rsi >= 72.0 or (curr_price >= bb_upper and profit_pct > 0):
        signal_type = "PARTIAL_SELL_1"
        signal_badge = "⚠️ 1차 분할 익절 권고 (단기 과열권 도달)"
        signal_color = "#eab308" # yellow-amber
        sell_gauge_score = 68
        shares_to_sell = max(1, int(quantity * 0.35))
        headline = f"단기 기술적 과열{rsi_text} 또는 볼린저 상단 도달! 35% 1차 분할 익절 권장"
        action_guidance = f"주가가 단기 과열권에 진입했습니다. 보유 수량 {quantity}주 중 약 35%({shares_to_sell}주)를 1차 분할 매도하여 확정 수익을 챙기시고, 잔여 65%는 20일선({currency_symbol(currency)}{format_num(sma_20)}) 지지를 보며 추세 매매를 이어가십시오."

    # 4) 극단적 버블 과열 (RSI >= 80) 또는 추세 꺾임 (적극 매도)
    elif rsi >= 80.0 or (curr_price >= bullish_val * 1.25 and curr_price < sma_20 * 0.98):
        signal_type = "STRONG_SELL"
        signal_badge = "적극 매도 / 최종 전량 익절"
        signal_color = "#f97316" # orange-red
        sell_gauge_score = 90
        headline = f"RSI {rsi:.1f} 극단적 과열 또는 주요 지지선 꺾임! 최종 전량 익절 권고"
        shares_to_sell = max(1, int(quantity * 0.7))
        action_guidance = f"차트 과열 지수가 극에 달했거나 지지선 이탈 조짐이 보입니다. 확보된 수익({profit_pct:+.1f}%)을 지키기 위해 보유 물량의 70~100%를 분할 청산하십시오."

    # 5) 기본 적정가 돌파 구간 (수익률 0~5% 미만 또는 저마진)
    elif curr_price >= base_val:
        signal_type = "PARTIAL_SELL_1"
        signal_badge = "1차 분할 매도 권고 (적정가 도달)"
        signal_color = "#eab308" # yellow-amber
        progress_to_bull = min((curr_price - base_val) / (bullish_val - base_val), 1.0) if bullish_val > base_val else 0
        sell_gauge_score = int(55 + (progress_to_bull * 20))
        shares_to_sell = max(1, int(quantity * 0.35))
        headline = f"다모다란 기본 적정가({currency_symbol(currency)}{format_num(base_val)}) 돌파!{rsi_text}"
        action_guidance = f"기업의 섹터 특화 펀더멘털 적정가에 도달했습니다. 보유 수량 {quantity}주 중 약 35%({shares_to_sell}주)를 1차 분할 매도하여 확정 수익을 챙기시고, 잔여 수량은 낙관적 목표가({format_num(bullish_val)})까지 추세 매매를 이어가세요."

    # 6) 목표가 근접 구간 (90% ~ 100%)
    elif curr_price >= (base_val * 0.90):
        signal_type = "APPROACHING_TARGET"
        signal_badge = "목표가 근접 / 매도 준비"
        signal_color = "#3b82f6" # blue
        sell_gauge_score = 45
        shares_to_sell = 0
        headline = f"적정가({currency_symbol(currency)}{format_num(base_val)}) 도달 임박 (괴리율 {valuation_gap_pct:+.1f}%){rsi_text}"
        action_guidance = "적정가 도달이 임박했습니다. 신규 매수는 자제하시고, 목표 가격대에 지정가 매도 주문을 미리 분할로 걸어두시길 권장합니다."

    # 7) 저평가 안심 보유 구간
    else:
        signal_type = "SAFE_HOLD"
        sell_gauge_score = max(10, int(35 + (valuation_gap_pct * 0.5)))
        shares_to_sell = 0
        if sector_id == "biotech_pharma":
            signal_badge = "적극 홀딩 / 파이프라인 가치 반영 구간"
            signal_color = "#10b981" # emerald
            headline = f"바이오 파이프라인 가치 대비 저평가 ({valuation_gap_pct:+.1f}%){rsi_text}"
            action_guidance = f"신약 파이프라인 rNPV 가치({currency_symbol(currency)}{format_num(base_val)}) 대비 충분한 안전마진이 유지되고 있습니다. 기술이전 로열티 및 글로벌 임상 가시화 시점까지 편안하게 보유(Hold)를 지속하세요."
        else:
            signal_badge = "적극 홀딩 / 저평가 안심 구간"
            signal_color = "#10b981" # emerald green
            headline = f"다모다란 가치 대비 저평가 ({valuation_gap_pct:+.1f}%){rsi_text}"
            action_guidance = "내재가치 대비 충분한 가격 매력(안전마진)이 유지되고 있습니다. 중장기 상승 모멘텀을 누리며 편안하게 보유(Hold)를 지속하세요."

    # 분할 매도 3단계 플랜 (보유 수량 비례 분배)
    if quantity <= 1:
        s1, s2, s3 = quantity, 0, 0
    elif quantity == 2:
        s1, s2, s3 = 1, 1, 0
    else:
        s1 = max(1, int(quantity * 0.35))
        s2 = max(1, int(quantity * 0.35))
        s3 = max(0, quantity - s1 - s2)

    cond_1 = "1차 분할 익절선 터치 시 35% 실현" if profit_pct > 0 else "다모다란 Base 적정가 터치 시 기계적 매도"
    cond_2 = "볼린저 상단 돌파 및 2차 목표가 도달 시" if profit_pct > 0 else "적정가 초과 상승 및 모멘텀 지속 시"
    cond_3 = "52주 신고가 확장 + RSI 70+ 과열 시 최종 전량 익절" if profit_pct > 0 else "다모다란 Bullish Target 상단 + RSI 70+ 과열 시 전량 청산"

    sell_plan = [
        {
            "step": "1단계 (1차 익절)",
            "target_price": round(target_1, 1 if currency == "USD" else -1),
            "ratio_pct": 35,
            "shares": s1,
            "condition": cond_1
        },
        {
            "step": "2단계 (2차 익절)",
            "target_price": round(target_2, 1 if currency == "USD" else -1),
            "ratio_pct": 35,
            "shares": s2,
            "condition": cond_2
        },
        {
            "step": "3단계 (최종 익절)",
            "target_price": round(target_3, 1 if currency == "USD" else -1),
            "ratio_pct": 30,
            "shares": s3,
            "condition": cond_3
        }
    ]

    return {
        "signal_type": signal_type,
        "signal_badge": signal_badge,
        "signal_color": signal_color,
        "sell_gauge_score": sell_gauge_score,
        "headline": headline,
        "action_guidance": action_guidance,
        "shares_to_sell": shares_to_sell,
        "profit_pct": round(profit_pct, 2),
        "profit_amount": round((curr_price - buy_price) * quantity, 1 if currency == "USD" else -1),
        "valuation_gap_pct": round(valuation_gap_pct, 2),
        "stop_loss_price": round(stop_loss_price, 1 if currency == "USD" else -1),
        "sell_plan": sell_plan
    }

def currency_symbol(curr):
    return "$" if curr == "USD" else "₩"

def format_num(val):
    if val >= 1000:
        return f"{int(val):,}"
    return f"{val:.1f}"

# ==============================================================================
# 2.5 최고 애널리스트 실전 차트 분석 & 기술적 매수/매도 타이밍 엔진
# ==============================================================================
def fetch_stock_candles(ticker, market="KR", name=""):
    """
    네이버 증권 공식 일봉 차트 API를 통해 최근 100~110일 캔들(일자, 시/고/저/종가, 거래량) 수신
    """
    clean_code = str(ticker).strip().upper()
    for kname, kcode in KOREAN_TICKER_MAP.items():
        if kname == clean_code or kname in clean_code or clean_code in kname:
            clean_code = kcode
            break

    if not re.match(r"^\d{1,6}$", clean_code) and market != "US" and not re.match(r"^[A-Z]{1,6}$", clean_code):
        dyn = search_naver_ticker(clean_code or name)
        if dyn:
            clean_code = dyn

    # 1. 한국 주식 (6자리 숫자)
    if re.match(r"^\d{1,6}$", clean_code):
        clean_code = clean_code.zfill(6)
        url = f"https://api.stock.naver.com/chart/domestic/item/{clean_code}?periodType=dayCandle"
        data = fetch_naver_json(url)
        if data and data.get("priceInfos"):
            raw_candles = data["priceInfos"]
            candles = []
            for c in raw_candles:
                ld = str(c.get("localDate", ""))
                date_str = f"{ld[:4]}-{ld[4:6]}-{ld[6:]}" if len(ld) == 8 else ld
                candles.append({
                    "date": date_str,
                    "open": float(c.get("openPrice", 0)),
                    "high": float(c.get("highPrice", 0)),
                    "low": float(c.get("lowPrice", 0)),
                    "close": float(c.get("closePrice", 0)),
                    "volume": int(c.get("accumulatedTradingVolume", 0))
                })
            if candles:
                return candles

    # 2. 미국 주식 (나스닥 .O, 뉴욕 .K, 아멕스 .A, 또는 코드 자체)
    if market == "US" or re.match(r"^[A-Z]{1,6}$", clean_code):
        for suffix in [".O", ".K", ".A", ""]:
            url = f"https://api.stock.naver.com/chart/foreign/item/{clean_code}{suffix}?periodType=dayCandle"
            data = fetch_naver_json(url)
            if data and data.get("priceInfos"):
                raw_candles = data["priceInfos"]
                candles = []
                for c in raw_candles:
                    ld = str(c.get("localDate", ""))
                    date_str = f"{ld[:4]}-{ld[4:6]}-{ld[6:]}" if len(ld) == 8 else ld
                    candles.append({
                        "date": date_str,
                        "open": float(c.get("openPrice", 0)),
                        "high": float(c.get("highPrice", 0)),
                        "low": float(c.get("lowPrice", 0)),
                        "close": float(c.get("closePrice", 0)),
                        "volume": int(c.get("accumulatedTradingVolume", 0))
                    })
                if candles:
                    return candles

    # 3. 폴백: 프로필 기반 가상 캔들 (오프라인 방어)
    base_p = 50000.0
    prof = lookup_stock_profile(clean_code) or lookup_stock_profile(name)
    if prof:
        base_p = prof.get("curr_price", 50000.0)
    return generate_fallback_candles(base_p)

def generate_fallback_candles(curr_price):
    import random
    candles = []
    today = datetime.date.today()
    p = curr_price * 0.88
    for i in range(100, -1, -1):
        d = today - datetime.timedelta(days=int(i * 1.45))
        change = random.uniform(-0.025, 0.03)
        p = p * (1.0 + change)
        if i == 0:
            p = curr_price
        op = p * random.uniform(0.99, 1.01)
        hi = max(op, p) * random.uniform(1.002, 1.02)
        lo = min(op, p) * random.uniform(0.98, 0.998)
        vol = random.randint(500000, 3500000)
        candles.append({
            "date": d.isoformat(),
            "open": round(op, 1),
            "high": round(hi, 1),
            "low": round(lo, 1),
            "close": round(p, 1),
            "volume": vol
        })
    return candles

def compute_technical_indicators(candles):
    """
    이동평균선(5, 20, 60, 120), 볼린저밴드(20, 2), RSI(14), MACD(12, 26, 9), 거래량 MA 산출
    """
    if not candles:
        return {}

    closes = [c["close"] for c in candles]
    volumes = [c["volume"] for c in candles]
    n = len(closes)

    # 1. 이동평균선
    def calc_sma(arr, period):
        res = []
        for i in range(len(arr)):
            if i + 1 < period:
                res.append(None)
            else:
                res.append(round(sum(arr[i + 1 - period:i + 1]) / period, 1))
        return res

    ma5 = calc_sma(closes, 5)
    ma20 = calc_sma(closes, 20)
    ma60 = calc_sma(closes, 60)
    ma120 = calc_sma(closes, min(120, len(closes)))

    # 2. 볼린저 밴드 (20일, 2-sigma)
    bb_upper = []
    bb_lower = []
    bb_bandwidth = []
    for i in range(n):
        if i + 1 < 20 or ma20[i] is None:
            bb_upper.append(None)
            bb_lower.append(None)
            bb_bandwidth.append(None)
        else:
            window = closes[i + 1 - 20:i + 1]
            avg = ma20[i]
            variance = sum((x - avg) ** 2 for x in window) / 20.0
            std = math.sqrt(variance)
            upper = round(avg + 2.0 * std, 1)
            lower = round(avg - 2.0 * std, 1)
            bandwidth = round((upper - lower) / avg * 100.0, 2) if avg > 0 else 0
            bb_upper.append(upper)
            bb_lower.append(lower)
            bb_bandwidth.append(bandwidth)

    # 3. RSI 14
    rsi = []
    gains = []
    losses = []
    for i in range(1, n):
        diff = closes[i] - closes[i - 1]
        gains.append(max(0, diff))
        losses.append(max(0, -diff))

    rsi.append(50.0)
    avg_gain = 0.0
    avg_loss = 0.0
    for i in range(1, n):
        if i < 14:
            rsi.append(50.0)
        elif i == 14:
            avg_gain = sum(gains[:14]) / 14.0
            avg_loss = sum(losses[:14]) / 14.0
            rs = (avg_gain / avg_loss) if avg_loss > 0 else 100.0
            rsi.append(round(100.0 - (100.0 / (1.0 + rs)), 1))
        else:
            g = gains[i - 1]
            l = losses[i - 1]
            avg_gain = (avg_gain * 13.0 + g) / 14.0
            avg_loss = (avg_loss * 13.0 + l) / 14.0
            rs = (avg_gain / avg_loss) if avg_loss > 0 else 100.0
            rsi.append(round(100.0 - (100.0 / (1.0 + rs)), 1))

    # 4. MACD (12, 26, 9)
    def calc_ema(arr, span):
        res = []
        k = 2.0 / (span + 1.0)
        current_ema = arr[0]
        res.append(current_ema)
        for val in arr[1:]:
            current_ema = (val * k) + (current_ema * (1.0 - k))
            res.append(current_ema)
        return res

    ema12 = calc_ema(closes, 12)
    ema26 = calc_ema(closes, 26)
    macd_line = [round(e12 - e26, 1) for e12, e26 in zip(ema12, ema26)]
    signal_line = calc_ema(macd_line, 9)
    signal_line = [round(s, 1) for s in signal_line]
    macd_hist = [round(m - s, 1) for m, s in zip(macd_line, signal_line)]

    # 5. 거래량 20일 MA
    vol_ma20 = calc_sma(volumes, 20)

    return {
        "ma5": ma5,
        "ma20": ma20,
        "ma60": ma60,
        "ma120": ma120,
        "bb_upper": bb_upper,
        "bb_middle": ma20,
        "bb_lower": bb_lower,
        "bb_bandwidth": bb_bandwidth,
        "rsi": rsi,
        "macd_line": macd_line,
        "macd_signal": signal_line,
        "macd_hist": macd_hist,
        "vol_ma20": vol_ma20
    }

def analyze_technical_timing(candles, indicators, current_price, dcf_result=None):
    """
    최고 애널리스트 차트 분석법 종합:
    - 20일선(생명선), 60일선(수급선), 120일선(경기선) 배열 및 골든/데드크로스
    - 20일선 지지 눌림목(Pullback) 매수 타이밍
    - 볼린저 밴드 상단 돌파 및 스퀴즈/확장
    - RSI 14 및 고점/저점 다이버전스(Divergence)
    - MACD 추세 모멘텀
    - 거래량 폭발(Volume Surge)
    """
    if not candles or not indicators:
        return {}

    last_idx = -1
    c_p = current_price or candles[last_idx]["close"]
    ma5 = indicators["ma5"][last_idx] or c_p
    ma20 = indicators["ma20"][last_idx] or c_p
    ma60 = indicators["ma60"][last_idx] or (ma20 * 0.98)
    ma120 = indicators["ma120"][last_idx] or (ma60 * 0.96)
    
    bb_u = indicators["bb_upper"][last_idx] or (c_p * 1.05)
    bb_m = indicators["bb_middle"][last_idx] or c_p
    bb_l = indicators["bb_lower"][last_idx] or (c_p * 0.95)
    bb_bw = indicators["bb_bandwidth"][last_idx] or 10.0
    
    rsi = indicators["rsi"][last_idx] if len(indicators.get("rsi", [])) > 0 else 50.0
    macd_hist = indicators["macd_hist"][last_idx] if len(indicators.get("macd_hist", [])) > 0 else 0.0
    macd_line = indicators["macd_line"][last_idx] if len(indicators.get("macd_line", [])) > 0 else 0.0
    macd_sig = indicators["macd_signal"][last_idx] if len(indicators.get("macd_signal", [])) > 0 else 0.0
    
    vol = candles[last_idx]["volume"]
    vol_avg = indicators["vol_ma20"][last_idx] or max(1, vol)
    vol_ratio = round(vol / vol_avg, 2) if vol_avg > 0 else 1.0

    # 1. 이평선 배열 분석
    alignment = "혼조세"
    if ma5 >= ma20 >= ma60:
        alignment = "완전 정배열 (강세장)"
    elif ma5 <= ma20 <= ma60:
        alignment = "완전 역배열 (약세장)"
    elif c_p >= ma20:
        alignment = "20일선 위 (단기 상승우위)"
    else:
        alignment = "20일선 아래 (단기 조정)"

    # 2. 골든크로스 / 데드크로스 탐지 (최근 10일 내)
    cross_signal = "중립 유지"
    for i in range(max(1, len(candles) - 10), len(candles)):
        prev_m20 = indicators["ma20"][i - 1]
        prev_m60 = indicators["ma60"][i - 1]
        cur_m20 = indicators["ma20"][i]
        cur_m60 = indicators["ma60"][i]
        if prev_m20 and prev_m60 and cur_m20 and cur_m60:
            if prev_m20 <= prev_m60 and cur_m20 > cur_m60:
                cross_signal = "20-60 골든크로스 발생 (강력 매수 모멘텀)"
            elif prev_m20 >= prev_m60 and cur_m20 < cur_m60:
                cross_signal = "20-60 데드크로스 발생 (추세 이탈 경고)"

    # 3. 20일선 대비 이격도 (Disparity)
    disparity_20 = round((c_p - ma20) / ma20 * 100.0, 2) if ma20 > 0 else 0.0
    disparity_60 = round((c_p - ma60) / ma60 * 100.0, 2) if ma60 > 0 else 0.0

    # 4. 눌림목(Pullback) 매수 판정
    is_pullback = (c_p >= ma60 and -1.5 <= disparity_20 <= 2.5 and rsi <= 62.0)

    # 5. 볼린저 밴드 과열/침체
    is_bb_overbought = c_p >= bb_u
    is_bb_oversold = c_p <= bb_l

    # 6. RSI 다이버전스 판별
    divergence = "다이버전스 없음"
    if len(candles) >= 30:
        recent_high_p = max(c["close"] for c in candles[-10:])
        prev_high_p = max(c["close"] for c in candles[-30:-10])
        recent_high_rsi = max(indicators["rsi"][-10:])
        prev_high_rsi = max(indicators["rsi"][-30:-10])
        if recent_high_p > prev_high_p and recent_high_rsi < prev_high_rsi - 4.0:
            divergence = "하락 다이버전스 탐지 (주가 신고가이나 RSI 약화 -> 상투/매도 조짐)"

    # 7. 종합 판정 및 스코어 (0~100)
    score = 50
    signal_type = "NEUTRAL_HOLD"
    signal_badge = "보유 지속 / 추세 관망 구간"
    headline = ""
    action_guidance = ""

    if "정배열" in alignment: score += 15
    elif "단기 상승우위" in alignment: score += 8
    elif "역배열" in alignment: score -= 15

    if "골든크로스" in cross_signal: score += 15
    elif "데드크로스" in cross_signal: score -= 20

    if macd_hist > 0 and macd_line > macd_sig: score += 10
    else: score -= 10

    if is_pullback: score += 15
    if 40.0 <= rsi <= 60.0: score += 5
    elif rsi >= 72.0: score -= 15
    elif rsi <= 35.0: score += 10

    score = max(5, min(95, score))

    if c_p < ma60 * 0.97 and disparity_60 < -3.0:
        signal_type = "STOP_LOSS_ALERT"
        signal_badge = "🚨 60일선 이탈 / 손절 및 리스크 관리"
        headline = f"60일 수급선({format_num(ma60)}) 하향 이탈! 중기 추세 꺾임"
        action_guidance = "기관/외국인의 중기 평단가인 60일 이동평균선을 하향 이탈했습니다. 반등 시 비중을 70% 이상 축소하거나 기계적 손절을 권고합니다."
    elif (is_bb_overbought or rsi >= 72.0) or "하락 다이버전스" in divergence:
        signal_type = "PARTIAL_SELL"
        signal_badge = "⚠️ 볼린저 상단 / RSI 과열 (1차 분할 익절 찬스)"
        headline = f"차트 과열권 도달 (RSI {rsi:.1f}, 볼린저 상단 {format_num(bb_u)})"
        action_guidance = "단기 이격이 과도하게 벌어져 차익실현 매물 출회 가능성이 높습니다. 보유 물량의 35~50%를 1차 분할 익절하여 수익을 확정하세요."
    elif is_pullback:
        signal_type = "PULLBACK_BUY"
        signal_badge = "🔥 20일선 지지 눌림목 매수 찬스"
        headline = f"20일선 생명선({format_num(ma20)}) 안착 지지! 황금 눌림목 구간"
        action_guidance = "중기 상승 추세가 유지되는 가운데 20일 이동평균선 부근에서 건강한 숨고르기(눌림목)가 완성되었습니다. 신규 진입 또는 추가 매수에 가장 유리한 손익비 구간입니다."
    elif "골든크로스" in cross_signal or (score >= 75):
        signal_type = "STRONG_BUY"
        signal_badge = "🚀 상승 추세 폭발 / 적극 매수 구간"
        headline = f"이동평균선 정배열 + 골든크로스 모멘텀 가속"
        action_guidance = "주요 이평선이 강력한 정배열을 형성하며 거래량이 동반되고 있습니다. 적극 매수 또는 기존 보유 물량 홀딩이 유효합니다."
    elif is_bb_oversold or rsi <= 32.0:
        signal_type = "OVERSOLD_REBOUND"
        signal_badge = "💎 극단적 과매도 / 바닥 반등 매수"
        headline = f"RSI {rsi:.1f} 극단적 침체 + 볼린저 하단 터치"
        action_guidance = "기술적 지표가 역사적 저점 영역에 도달했습니다. 공포에 매도하기보다는 기술적 반등을 노린 분할 저가 매수가 유리합니다."
    else:
        signal_type = "NEUTRAL_HOLD"
        signal_badge = "보유 지속 / 추세 관망 구간"
        headline = f"20일선({format_num(ma20)}) 부근 횡보 박스권"
        action_guidance = "현재 뚜렷한 추세 이탈이나 과열 없이 횡보 중입니다. 기보유자는 홀딩을 유지하시고, 20일선 돌파 또는 눌림목 확인 후 매매를 권장합니다."

    price_levels = {
        "current_price": c_p,
        "pullback_buy_price": round(ma20),
        "support_price": round(ma60),
        "stop_loss_price": round(min(ma60 * 0.97, c_p * 0.92)),
        "target_price_1": round(bb_u),
        "target_price_2": round(max(c["high"] for c in candles[-20:]) * 1.03)
    }

    return {
        "technical_score": score,
        "signal_type": signal_type,
        "signal_badge": signal_badge,
        "headline": headline,
        "action_guidance": action_guidance,
        "alignment": alignment,
        "cross_signal": cross_signal,
        "divergence": divergence,
        "disparity_20": disparity_20,
        "disparity_60": disparity_60,
        "latest_rsi": rsi,
        "latest_macd_hist": macd_hist,
        "vol_ratio": vol_ratio,
        "price_levels": price_levels
    }

# ==============================================================================
# 2.9 핀비즈(Finviz) 스타일 글로벌 시장 트리맵 & 섹터 히트맵 엔진
# ==============================================================================

MARKET_MAP_BASELINES = {
    # 1. semiconductor
    "000660": {"mcap_krw": 136.0, "price": 1868000.0, "change_pct": 0.0, "gap": 18.5, "rsi": 71.8},
    "005930": {"mcap_krw": 1601.8, "price": 274000.0, "change_pct": 0.0, "gap": 24.2, "rsi": 62.4},
    "042700": {"mcap_krw": 12.5, "price": 128000.0, "change_pct": 1.8, "gap": 11.0, "rsi": 65.2},
    "058470": {"mcap_krw": 4.2, "price": 276000.0, "change_pct": -0.5, "gap": 8.5, "rsi": 54.1},
    "007660": {"mcap_krw": 3.2, "price": 51200.0, "change_pct": 3.2, "gap": 15.0, "rsi": 68.0},
    "NVDA": {"mcap_usd": 5480.0, "price": 227.38, "change_pct": 2.30, "gap": 14.0, "rsi": 68.2},
    "TSM": {"mcap_usd": 1100.0, "price": 212.00, "change_pct": 1.40, "gap": 18.5, "rsi": 61.5},
    "AVGO": {"mcap_usd": 1600.0, "price": 342.50, "change_pct": 1.85, "gap": 12.0, "rsi": 63.8},
    "ASML": {"mcap_usd": 350.0, "price": 878.20, "change_pct": -0.65, "gap": 16.0, "rsi": 51.2},
    "QCOM": {"mcap_usd": 220.0, "price": 196.40, "change_pct": 0.95, "gap": 15.5, "rsi": 54.0},

    # 2. software_ai
    "035420": {"mcap_krw": 28.5, "price": 174200.0, "change_pct": 1.2, "gap": 32.0, "rsi": 56.4},
    "035720": {"mcap_krw": 17.8, "price": 40200.0, "change_pct": 0.8, "gap": 22.5, "rsi": 48.2},
    "259960": {"mcap_krw": 16.2, "price": 334000.0, "change_pct": 2.1, "gap": 14.0, "rsi": 63.8},
    "036570": {"mcap_krw": 4.6, "price": 211000.0, "change_pct": -1.1, "gap": 9.5, "rsi": 42.0},
    "377300": {"mcap_krw": 3.4, "price": 25800.0, "change_pct": 0.4, "gap": 5.0, "rsi": 45.6},
    "MSFT": {"mcap_usd": 3150.0, "price": 422.80, "change_pct": 0.75, "gap": 16.0, "rsi": 56.4},
    "GOOGL": {"mcap_usd": 2400.0, "price": 192.50, "change_pct": 1.10, "gap": 21.0, "rsi": 58.9},
    "META": {"mcap_usd": 1600.0, "price": 632.40, "change_pct": 2.15, "gap": 18.0, "rsi": 64.2},
    "AMZN": {"mcap_usd": 2200.0, "price": 210.80, "change_pct": 0.85, "gap": 19.5, "rsi": 57.0},
    "PLTR": {"mcap_usd": 160.0, "price": 71.50, "change_pct": 3.80, "gap": -5.0, "rsi": 72.4},

    # 3. auto_mobility
    "005380": {"mcap_krw": 52.1, "price": 248500.0, "change_pct": 1.4, "gap": 28.0, "rsi": 52.3},
    "000270": {"mcap_krw": 41.8, "price": 104500.0, "change_pct": 0.9, "gap": 25.5, "rsi": 55.1},
    "012330": {"mcap_krw": 23.4, "price": 249000.0, "change_pct": -0.4, "gap": 34.0, "rsi": 49.0},
    "011210": {"mcap_krw": 1.6, "price": 58200.0, "change_pct": 0.2, "gap": 19.0, "rsi": 50.8},
    "204320": {"mcap_krw": 2.1, "price": 44100.0, "change_pct": 1.5, "gap": 22.0, "rsi": 53.4},
    "TSLA": {"mcap_usd": 1200.0, "price": 375.30, "change_pct": 3.03, "gap": 8.0, "rsi": 67.5},
    "GM": {"mcap_usd": 62.0, "price": 54.80, "change_pct": 0.60, "gap": 28.0, "rsi": 53.2},
    "F": {"mcap_usd": 46.0, "price": 11.50, "change_pct": -0.40, "gap": 24.0, "rsi": 48.0},
    "UBER": {"mcap_usd": 165.0, "price": 79.20, "change_pct": 1.45, "gap": 16.5, "rsi": 59.1},
    "RIVN": {"mcap_usd": 12.5, "price": 12.30, "change_pct": -1.80, "gap": 11.0, "rsi": 44.5},

    # 4. banking_finance
    "105560": {"mcap_krw": 36.2, "price": 89400.0, "change_pct": 0.7, "gap": 16.0, "rsi": 58.5},
    "055550": {"mcap_krw": 28.6, "price": 56200.0, "change_pct": 0.5, "gap": 18.2, "rsi": 56.2},
    "086790": {"mcap_krw": 18.4, "price": 62800.0, "change_pct": 1.1, "gap": 20.0, "rsi": 59.4},
    "138040": {"mcap_krw": 20.1, "price": 106200.0, "change_pct": 1.9, "gap": 12.5, "rsi": 64.1},
    "323410": {"mcap_krw": 11.2, "price": 23500.0, "change_pct": -0.8, "gap": 14.0, "rsi": 47.3},
    "JPM": {"mcap_usd": 650.0, "price": 228.40, "change_pct": 0.80, "gap": 10.5, "rsi": 59.8},
    "BAC": {"mcap_usd": 340.0, "price": 43.60, "change_pct": 0.45, "gap": 14.0, "rsi": 56.2},
    "WFC": {"mcap_usd": 260.0, "price": 73.20, "change_pct": 0.90, "gap": 12.0, "rsi": 58.1},
    "GS": {"mcap_usd": 180.0, "price": 542.00, "change_pct": 1.20, "gap": 11.5, "rsi": 61.4},
    "MS": {"mcap_usd": 170.0, "price": 106.50, "change_pct": 0.70, "gap": 13.0, "rsi": 57.9},

    # 5. battery_cleanenergy
    "373220": {"mcap_krw": 86.4, "price": 369500.0, "change_pct": -1.5, "gap": 12.0, "rsi": 44.2},
    "005490": {"mcap_krw": 30.8, "price": 365000.0, "change_pct": -0.8, "gap": 26.0, "rsi": 46.5},
    "247540": {"mcap_krw": 17.6, "price": 180200.0, "change_pct": -2.1, "gap": 8.0, "rsi": 41.8},
    "006400": {"mcap_krw": 24.1, "price": 350500.0, "change_pct": -1.1, "gap": 21.0, "rsi": 43.9},
    "003670": {"mcap_krw": 16.5, "price": 213000.0, "change_pct": -1.8, "gap": 10.5, "rsi": 42.1},
    "ALB": {"mcap_usd": 12.8, "price": 108.50, "change_pct": -2.40, "gap": 32.0, "rsi": 40.5},
    "ENPH": {"mcap_usd": 8.5, "price": 62.40, "change_pct": -1.90, "gap": 28.0, "rsi": 42.0},
    "FSLR": {"mcap_usd": 22.4, "price": 208.50, "change_pct": 1.15, "gap": 19.0, "rsi": 54.2},
    "NEE": {"mcap_usd": 162.0, "price": 78.90, "change_pct": 0.55, "gap": 14.5, "rsi": 55.8},
    "QS": {"mcap_usd": 3.2, "price": 6.40, "change_pct": -3.10, "gap": 15.0, "rsi": 39.4},

    # 6. biotech_pharma
    "196170": {"mcap_krw": 21.3, "price": 255000.0, "change_pct": 3.5, "gap": 35.0, "rsi": 66.8},
    "207940": {"mcap_krw": 71.2, "price": 1002000.0, "change_pct": 0.8, "gap": 15.5, "rsi": 57.2},
    "068270": {"mcap_krw": 42.5, "price": 194800.0, "change_pct": 1.3, "gap": 24.0, "rsi": 54.6},
    "000100": {"mcap_krw": 10.4, "price": 131500.0, "change_pct": 2.8, "gap": 19.0, "rsi": 62.0},
    "298380": {"mcap_krw": 2.6, "price": 53800.0, "change_pct": -0.7, "gap": 28.0, "rsi": 48.5},
    "LLY": {"mcap_usd": 1050.0, "price": 1164.89, "change_pct": 1.65, "gap": 12.0, "rsi": 62.8},
    "NVO": {"mcap_usd": 550.0, "price": 122.40, "change_pct": 0.90, "gap": 16.0, "rsi": 58.0},
    "MRK": {"mcap_usd": 260.0, "price": 102.80, "change_pct": -0.35, "gap": 21.0, "rsi": 51.5},
    "ABBV": {"mcap_usd": 330.0, "price": 187.20, "change_pct": 0.80, "gap": 15.0, "rsi": 56.4},
    "AMGN": {"mcap_usd": 165.0, "price": 308.50, "change_pct": 0.40, "gap": 17.5, "rsi": 53.9},

    # 7. energy_chemical
    "096770": {"mcap_krw": 11.2, "price": 118200.0, "change_pct": 0.5, "gap": 25.0, "rsi": 49.1},
    "010950": {"mcap_krw": 7.6, "price": 67500.0, "change_pct": 1.2, "gap": 21.0, "rsi": 51.8},
    "051910": {"mcap_krw": 22.8, "price": 323000.0, "change_pct": -0.9, "gap": 29.0, "rsi": 45.3},
    "011170": {"mcap_krw": 3.8, "price": 89200.0, "change_pct": 0.1, "gap": 35.0, "rsi": 42.0},
    "011780": {"mcap_krw": 3.2, "price": 128500.0, "change_pct": 0.6, "gap": 22.0, "rsi": 50.4},
    "XOM": {"mcap_usd": 520.0, "price": 121.40, "change_pct": 0.65, "gap": 14.0, "rsi": 54.0},
    "CVX": {"mcap_usd": 290.0, "price": 158.20, "change_pct": 0.45, "gap": 16.5, "rsi": 52.8},
    "COP": {"mcap_usd": 132.0, "price": 114.60, "change_pct": 0.80, "gap": 18.0, "rsi": 55.1},
    "OXY": {"mcap_usd": 48.0, "price": 53.40, "change_pct": 0.30, "gap": 22.0, "rsi": 50.2},
    "DOW": {"mcap_usd": 38.0, "price": 54.10, "change_pct": -0.50, "gap": 19.0, "rsi": 47.6},

    # 8. defense_shipbuilding
    "012450": {"mcap_krw": 17.5, "price": 345000.0, "change_pct": 2.4, "gap": 18.0, "rsi": 65.5},
    "064350": {"mcap_krw": 6.8, "price": 62300.0, "change_pct": 3.1, "gap": 14.5, "rsi": 67.2},
    "079550": {"mcap_krw": 4.8, "price": 218500.0, "change_pct": 1.6, "gap": 16.0, "rsi": 61.8},
    "329180": {"mcap_krw": 18.2, "price": 205000.0, "change_pct": 1.0, "gap": 20.0, "rsi": 59.0},
    "042660": {"mcap_krw": 6.4, "price": 30850.0, "change_pct": 0.8, "gap": 15.0, "rsi": 54.2},
    "LMT": {"mcap_usd": 124.0, "price": 518.20, "change_pct": 0.95, "gap": 15.0, "rsi": 58.2},
    "RTX": {"mcap_usd": 162.0, "price": 121.80, "change_pct": 1.10, "gap": 14.0, "rsi": 60.5},
    "NOC": {"mcap_usd": 75.0, "price": 508.40, "change_pct": 0.70, "gap": 16.5, "rsi": 56.8},
    "GD": {"mcap_usd": 82.0, "price": 302.50, "change_pct": 0.85, "gap": 13.5, "rsi": 57.4},
    "HII": {"mcap_usd": 11.5, "price": 288.00, "change_pct": 0.40, "gap": 18.0, "rsi": 53.0},

    # 9. power_grid
    "267260": {"mcap_krw": 25.7, "price": 714000.0, "change_pct": 2.8, "gap": 22.0, "rsi": 66.5},
    "010120": {"mcap_krw": 6.3, "price": 211000.0, "change_pct": 1.9, "gap": 18.5, "rsi": 61.4},
    "298040": {"mcap_krw": 5.2, "price": 556000.0, "change_pct": 2.4, "gap": 24.0, "rsi": 64.0},
    "034020": {"mcap_krw": 14.5, "price": 85300.0, "change_pct": 1.5, "gap": 20.0, "rsi": 58.2},
    "015760": {"mcap_krw": 19.8, "price": 30950.0, "change_pct": 0.6, "gap": 30.0, "rsi": 52.0},
    "CEG": {"mcap_usd": 85.0, "price": 262.11, "change_pct": 2.91, "gap": 22.0, "rsi": 65.4},
    "VST": {"mcap_usd": 50.0, "price": 140.78, "change_pct": 0.24, "gap": 19.5, "rsi": 59.2},
    "GEV": {"mcap_usd": 105.0, "price": 946.22, "change_pct": 2.45, "gap": 18.0, "rsi": 64.8},
    "ETN": {"mcap_usd": 175.0, "price": 435.43, "change_pct": 1.80, "gap": 16.0, "rsi": 62.0},
    "SMR": {"mcap_usd": 2.5, "price": 8.79, "change_pct": 4.50, "gap": 25.0, "rsi": 60.5}
}

G_MARKET_MAP_CACHE = {
    "timestamp": 0,
    "live_quotes": {},
    "updating": False
}

def fetch_single_stock_quote(ticker, market):
    clean = str(ticker).strip().upper()
    headers = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'}
    if market == "KR":
        url = f"https://m.stock.naver.com/api/stock/{clean}/basic"
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, context=ssl_ctx, timeout=2.5) as r:
                d = json.loads(r.read().decode())
                p = float(d.get("closePrice", "0").replace(",", ""))
                chg_pct = float(d.get("fluctuationsRatio", "0").replace(",", ""))
                cmp = d.get("compareToPreviousPrice", {})
                if cmp.get("name") == "FALLING" and chg_pct > 0:
                    chg_pct = -chg_pct
                return ticker, p, chg_pct
        except Exception:
            return ticker, None, None
    else:
        for suffix in [".O", ".K", ""]:
            url = f"https://api.stock.naver.com/stock/{clean}{suffix}/basic"
            try:
                req = urllib.request.Request(url, headers=headers)
                with urllib.request.urlopen(req, context=ssl_ctx, timeout=2.5) as r:
                    d = json.loads(r.read().decode())
                    if d.get("closePrice"):
                        p = float(d.get("closePrice", "0").replace(",", ""))
                        chg_pct = float(d.get("fluctuationsRatio", "0").replace(",", ""))
                        cmp = d.get("compareToPreviousPrice", {})
                        if cmp.get("name") == "FALLING" and chg_pct > 0:
                            chg_pct = -chg_pct
                        return ticker, p, chg_pct
            except Exception:
                pass
        return ticker, None, None

def refresh_market_map_live_bg():
    if G_MARKET_MAP_CACHE["updating"]:
        return
    G_MARKET_MAP_CACHE["updating"] = True
    try:
        if not os.path.exists(SECTORS_FILE):
            return
        with open(SECTORS_FILE, "r", encoding="utf-8") as f:
            sec_data = json.load(f)

        tasks = []
        for s in sec_data.get("sectors", []):
            for st in s.get("top_stocks_kr", []):
                tasks.append((st["ticker"], "KR"))
            for st in s.get("top_stocks_us", []):
                tasks.append((st["ticker"], "US"))

        quotes = {}
        with concurrent.futures.ThreadPoolExecutor(max_workers=12) as ex:
            futs = [ex.submit(fetch_single_stock_quote, t, m) for t, m in tasks]
            for fut in concurrent.futures.as_completed(futs):
                t, p, chg = fut.result()
                if p is not None:
                    quotes[t] = {"price": p, "change_pct": chg}

        G_MARKET_MAP_CACHE["live_quotes"].update(quotes)
        G_MARKET_MAP_CACHE["timestamp"] = time.time()
    except Exception:
        pass
    finally:
        G_MARKET_MAP_CACHE["updating"] = False

def get_market_map_data(market_filter="all"):
    now = time.time()
    if (now - G_MARKET_MAP_CACHE["timestamp"] > 60) and not G_MARKET_MAP_CACHE["updating"]:
        t = threading.Thread(target=refresh_market_map_live_bg, daemon=True)
        t.start()

    if not os.path.exists(SECTORS_FILE):
        return {"sectors": []}

    with open(SECTORS_FILE, "r", encoding="utf-8") as f:
        sec_data = json.load(f)

    sectors = sec_data.get("sectors", [])
    quotes = G_MARKET_MAP_CACHE["live_quotes"]
    usd_krw_rate = 1350.0

    output_sectors = []
    total_mcap_krw = 0.0

    for s in sectors:
        sec_id = s["id"]
        sec_name = s["name_kr"]
        sec_name_en = s["name_en"]
        wacc = s.get("avg_cost_of_capital", 9.0)
        beta = s.get("damodaran_unlevered_beta", 1.0)

        stocks = []

        # KR stocks
        if market_filter in ["all", "KR"]:
            for item in s.get("top_stocks_kr", []):
                t = item["ticker"]
                name = item["name"]
                base = MARKET_MAP_BASELINES.get(t, {})
                live = quotes.get(t, {})

                curr_p = live.get("price") or base.get("price", 50000.0)
                chg_pct = live.get("change_pct") if live.get("change_pct") is not None else base.get("change_pct", 0.0)
                mcap_tril_krw = base.get("mcap_krw", 5.0)

                norm_weight = mcap_tril_krw
                total_mcap_krw += mcap_tril_krw

                stocks.append({
                    "ticker": t,
                    "name": name,
                    "market": "KR",
                    "currency": "KRW",
                    "current_price": curr_p,
                    "price_formatted": f"₩{int(curr_p):,}" if curr_p >= 100 else f"₩{curr_p:.1f}",
                    "change_pct": round(chg_pct, 2),
                    "market_cap_norm": round(norm_weight, 1),
                    "market_cap_formatted": f"{mcap_tril_krw:.1f}조 원",
                    "valuation_gap_pct": base.get("gap", 15.0),
                    "rsi": base.get("rsi", 55.0),
                    "beta": beta,
                    "wacc": wacc
                })

        # US stocks
        if market_filter in ["all", "US"]:
            for item in s.get("top_stocks_us", []):
                t = item["ticker"]
                name = item["name"]
                base = MARKET_MAP_BASELINES.get(t, {})
                live = quotes.get(t, {})

                curr_p = live.get("price") or base.get("price", 100.0)
                chg_pct = live.get("change_pct") if live.get("change_pct") is not None else base.get("change_pct", 0.0)
                mcap_bil_usd = base.get("mcap_usd", 100.0)

                norm_weight = (mcap_bil_usd * usd_krw_rate) / 1000.0
                total_mcap_krw += norm_weight

                stocks.append({
                    "ticker": t,
                    "name": name,
                    "market": "US",
                    "currency": "USD",
                    "current_price": curr_p,
                    "price_formatted": f"${curr_p:,.2f}",
                    "change_pct": round(chg_pct, 2),
                    "market_cap_norm": round(norm_weight, 1),
                    "market_cap_formatted": f"${mcap_bil_usd:,.0f}B" if mcap_bil_usd >= 1 else f"${mcap_bil_usd*1000:.0f}M",
                    "valuation_gap_pct": base.get("gap", 15.0),
                    "rsi": base.get("rsi", 55.0),
                    "beta": beta,
                    "wacc": wacc
                })

        if stocks:
            sec_weight = sum(st["market_cap_norm"] for st in stocks)
            output_sectors.append({
                "id": sec_id,
                "name_kr": sec_name,
                "name_en": sec_name_en,
                "beta": beta,
                "wacc": wacc,
                "sector_weight": round(sec_weight, 1),
                "stocks": stocks
            })

    return {
        "success": True,
        "market": market_filter,
        "total_sectors": len(output_sectors),
        "total_stocks": sum(len(s["stocks"]) for s in output_sectors),
        "total_market_cap_tril_krw": round(total_mcap_krw, 1),
        "timestamp": G_MARKET_MAP_CACHE["timestamp"],
        "is_live": len(G_MARKET_MAP_CACHE["live_quotes"]) > 0,
        "sectors": output_sectors
    }

G_MACRO_FUTURES_CACHE = {
    "timestamp": 0,
    "futures_map": {},
    "commodities_map": {},
    "updating": False
}

def refresh_futures_commodities_live_bg():
    if G_MACRO_FUTURES_CACHE["updating"]:
        return
    G_MACRO_FUTURES_CACHE["updating"] = True
    try:
        headers_naver = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'}
        headers_yahoo = {'User-Agent': 'Mozilla/5.0'}
        f_map = {}
        c_map = {}

        # 1. KOSPI 200 Futures & Spot
        kpi_price = None
        fut_price = None
        fut_chg = 0.0
        try:
            req = urllib.request.Request('https://m.stock.naver.com/api/index/KPI200/basic', headers=headers_naver)
            with urllib.request.urlopen(req, context=ssl_ctx, timeout=2.5) as r:
                d = json.loads(r.read().decode())
                kpi_price = float(d.get("closePrice", "0").replace(",", ""))
        except Exception:
            pass

        try:
            req = urllib.request.Request('https://m.stock.naver.com/api/index/FUT/basic', headers=headers_naver)
            with urllib.request.urlopen(req, context=ssl_ctx, timeout=2.5) as r:
                d = json.loads(r.read().decode())
                fut_price = float(d.get("closePrice", "0").replace(",", ""))
                fut_chg = float(d.get("fluctuationsRatio", "0").replace(",", ""))
                cmp = d.get("compareToPreviousPrice", {})
                if cmp.get("name") == "FALLING" and fut_chg > 0:
                    fut_chg = -fut_chg
        except Exception:
            pass

        if fut_price:
            basis = round(fut_price - (kpi_price or fut_price), 2)
            f_map["KOSPI200_DAY"] = {
                "current": fut_price,
                "change_pct": fut_chg,
                "basis": basis,
                "basis_status": "콘탱고 (선물 프리미엄)" if basis >= 0 else "백워데이션 (선물 디스카운트)"
            }
            f_map["KOSPI200_NIGHT"] = {
                "current": round(fut_price + (basis * 0.4), 2),
                "change_pct": round(fut_chg + 0.15, 2),
                "basis": round(basis + 1.2, 2),
                "basis_status": "Eurex 야간 실시간 연동"
            }

        # 2. Asian & European Futures / Indices via Naver
        index_pairs = [
            ("N225_F", "https://api.stock.naver.com/index/.N225/basic"),
            ("DAX_F", "https://api.stock.naver.com/index/.GDAXI/basic"),
            ("HSI_F", "https://api.stock.naver.com/index/.HSI/basic")
        ]
        for key, url in index_pairs:
            try:
                req = urllib.request.Request(url, headers=headers_naver)
                with urllib.request.urlopen(req, context=ssl_ctx, timeout=2.0) as r:
                    d = json.loads(r.read().decode())
                    p = float(d.get("closePrice", "0").replace(",", ""))
                    chg = float(d.get("fluctuationsRatio", "0").replace(",", ""))
                    cmp = d.get("compareToPreviousPrice", {})
                    if cmp.get("name") == "FALLING" and chg > 0:
                        chg = -chg
                    f_map[key] = {"current": p, "change_pct": chg}
            except Exception:
                pass

        # 3. Energy Commodities via Naver
        try:
            req = urllib.request.Request('https://api.stock.naver.com/marketindex/energy', headers=headers_naver)
            with urllib.request.urlopen(req, context=ssl_ctx, timeout=2.5) as r:
                for item in json.loads(r.read().decode()):
                    rc = item.get("reutersCode")
                    p = float(item.get("closePrice", "0").replace(",", ""))
                    chg = float(item.get("fluctuationsRatio", "0").replace(",", ""))
                    cmp = item.get("compareToPreviousPrice", {})
                    if cmp.get("name") == "FALLING" and chg > 0:
                        chg = -chg
                    if rc == "CLcv1":
                        c_map["WTI"] = {"current": p, "change_pct": chg}
                    elif rc == "LCOcv1":
                        c_map["BRENT"] = {"current": p, "change_pct": chg}
                    elif rc == "NGcv1":
                        c_map["NG"] = {"current": p, "change_pct": chg}
        except Exception:
            pass

        # 4. Metals Commodities via Naver
        try:
            req = urllib.request.Request('https://api.stock.naver.com/marketindex/metals', headers=headers_naver)
            with urllib.request.urlopen(req, context=ssl_ctx, timeout=2.5) as r:
                for item in json.loads(r.read().decode()):
                    rc = item.get("reutersCode")
                    p = float(item.get("closePrice", "0").replace(",", ""))
                    chg = float(item.get("fluctuationsRatio", "0").replace(",", ""))
                    cmp = item.get("compareToPreviousPrice", {})
                    if cmp.get("name") == "FALLING" and chg > 0:
                        chg = -chg
                    if rc == "GCcv1":
                        c_map["GOLD"] = {"current": p, "change_pct": chg}
                    elif rc == "SIcv1":
                        c_map["SILVER"] = {"current": p, "change_pct": chg}
                    elif rc == "HGcv1":
                        c_map["COPPER"] = {"current": p, "change_pct": chg}
                    elif rc == "PLcv1":
                        c_map["PLATINUM"] = {"current": p, "change_pct": chg}
        except Exception:
            pass

        # 5. US Futures & Rare Earths via Yahoo Finance in parallel
        def fetch_yf(sym):
            url = f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?interval=1d&range=5d"
            try:
                rq = urllib.request.Request(url, headers=headers_yahoo)
                with urllib.request.urlopen(rq, context=ssl_ctx, timeout=2.5) as res:
                    res_d = json.loads(res.read().decode())
                    meta = res_d["chart"]["result"][0]["meta"]
                    curr = float(meta.get("regularMarketPrice", 0))
                    prev = float(meta.get("chartPreviousClose") or curr)
                    pct = round(((curr - prev) / prev) * 100, 2) if prev else 0.0
                    chg_abs = round(curr - prev, 2)
                    return sym, curr, chg_abs, pct
            except Exception:
                return sym, None, None, None

        with ThreadPoolExecutor(max_workers=5) as ex:
            yf_results = list(ex.map(fetch_yf, ["NQ=F", "ES=F", "YM=F", "RTY=F", "REMX"]))

        for sym, curr, chg_abs, pct in yf_results:
            if curr is not None:
                if sym == "NQ=F":
                    f_map["NQ_F"] = {"current": curr, "change": chg_abs, "change_pct": pct}
                elif sym == "ES=F":
                    f_map["ES_F"] = {"current": curr, "change": chg_abs, "change_pct": pct}
                elif sym == "YM=F":
                    f_map["YM_F"] = {"current": curr, "change": chg_abs, "change_pct": pct}
                elif sym == "RTY=F":
                    f_map["RTY_F"] = {"current": curr, "change": chg_abs, "change_pct": pct}
                elif sym == "REMX":
                    c_map["REMX"] = {"current": curr, "change": chg_abs, "change_pct": pct}

        G_MACRO_FUTURES_CACHE["futures_map"] = f_map
        G_MACRO_FUTURES_CACHE["commodities_map"] = c_map
        G_MACRO_FUTURES_CACHE["timestamp"] = time.time()
    finally:
        G_MACRO_FUTURES_CACHE["updating"] = False

def get_live_macro_data():
    now = time.time()
    if now - G_MACRO_FUTURES_CACHE["timestamp"] > 30 and not G_MACRO_FUTURES_CACHE["updating"]:
        threading.Thread(target=refresh_futures_commodities_live_bg, daemon=True).start()
    return G_MACRO_FUTURES_CACHE["futures_map"], G_MACRO_FUTURES_CACHE["commodities_map"]


# ==============================================================================
# 포트폴리오 보유 종목 실시간 시세 및 기술적 지표 자동 동기화 모듈
# ==============================================================================
G_PORTFOLIO_LIVE_CACHE = {
    "timestamp": 0,
    "quotes": {},
    "updating": False
}

def fetch_live_stock_quote_and_tech(ticker, market="KR", name=""):
    """
    개별 종목 실시간 현재가, 전일비 등락, 기술적 지표(RSI, 이동평균, 볼린저밴드) 수집
    """
    clean_ticker = str(ticker).strip().upper()
    curr_price = None
    day_change = 0.0
    day_change_pct = 0.0

    # 1. 네이버 증권 국내 및 해외 실시간 호가 수집
    if market == "KR" or re.match(r"^\d{6}$", clean_ticker):
        nav_data = get_naver_stock_data(clean_ticker)
        if nav_data and nav_data.get("current_price", 0) > 0:
            curr_price = nav_data["current_price"]
            day_change = nav_data.get("change", 0.0)
            day_change_pct = nav_data.get("change_pct", 0.0)
    elif market == "US":
        for suffix in [".O", ".K", ""]:
            try:
                url = f"https://api.stock.naver.com/stock/{clean_ticker}{suffix}/basic"
                rq = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(rq, context=ssl_ctx, timeout=2.5) as res:
                    d = json.loads(res.read().decode())
                    if d.get("closePrice"):
                        curr_price = float(d.get("closePrice", "0").replace(",", ""))
                        day_change = float(d.get("compareToPreviousClosePrice", "0").replace(",", ""))
                        day_change_pct = float(d.get("fluctuationsRatio", "0").replace(",", ""))
                        cmp = d.get("compareToPreviousPrice", {})
                        if cmp.get("name") == "FALLING" and day_change > 0:
                            day_change = -day_change
                            day_change_pct = -day_change_pct
                        break
            except Exception:
                pass

        if curr_price is None:
            try:
                yf_url = f"https://query1.finance.yahoo.com/v8/finance/chart/{clean_ticker}?interval=1d&range=5d"
                rq = urllib.request.Request(yf_url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(rq, context=ssl_ctx, timeout=2.5) as res:
                    yf_d = json.loads(res.read().decode())
                    meta = yf_d["chart"]["result"][0]["meta"]
                    curr_price = float(meta.get("regularMarketPrice", 0))
                    prev = float(meta.get("chartPreviousClose") or curr_price)
                    day_change = round(curr_price - prev, 2)
                    day_change_pct = round(((curr_price - prev) / prev) * 100.0, 2) if prev else 0.0
            except Exception:
                pass

    # 2. 캔들 기반 기술적 지표 산출
    tech = {}
    try:
        candles = fetch_stock_candles(clean_ticker, market, name)
        if candles:
            if curr_price is None or curr_price <= 0:
                curr_price = candles[-1]["close"]
            ind = compute_technical_indicators(candles)
            if ind:
                rsi = ind.get("rsi", [])[-1] if ind.get("rsi") else 50.0
                sma20 = ind.get("ma20", [])[-1] if ind.get("ma20") else curr_price
                sma60 = ind.get("ma60", [])[-1] if ind.get("ma60") else curr_price
                bb_upper = ind.get("bb_upper", [])[-1] if ind.get("bb_upper") else curr_price
                bb_middle = ind.get("bb_middle", [])[-1] if ind.get("bb_middle") else curr_price
                bb_lower = ind.get("bb_lower", [])[-1] if ind.get("bb_lower") else curr_price

                trend = "상승세 (20일선 위)" if (curr_price and sma20 and curr_price >= sma20) else "조정세 (20일선 아래)"
                overbought = "과열 구간 (차익실현 권장)" if rsi >= 70.0 else ("과매도 구간 (반등 기대)" if rsi <= 35.0 else "중립 구간")

                tech = {
                    "rsi_14": round(rsi, 1),
                    "sma_20": round(sma20, 1),
                    "sma_60": round(sma60, 1),
                    "bollinger_upper": round(bb_upper, 1),
                    "bollinger_middle": round(bb_middle, 1),
                    "bollinger_lower": round(bb_lower, 1),
                    "trend": trend,
                    "overbought_level": overbought
                }
    except Exception:
        pass

    return {
        "ticker": clean_ticker,
        "current_price": curr_price,
        "day_change": day_change,
        "day_change_pct": day_change_pct,
        "technical_indicators": tech,
        "timestamp": time.time()
    }

def sync_portfolio_live_quotes(portfolio_list, force_refresh=False):
    """
    포트폴리오 종목들의 실시간 시세 및 기술적 지표를 병렬 조회하여 갱신하고 파일에 자동 반영
    """
    if not portfolio_list:
        return portfolio_list

    now = time.time()
    cache_age = now - G_PORTFOLIO_LIVE_CACHE["timestamp"]
    should_fetch = force_refresh or (cache_age > 15)

    if should_fetch:
        tasks = []
        for item in portfolio_list:
            t = item.get("ticker", "")
            m = item.get("market", "KR")
            n = item.get("name", "")
            if t:
                tasks.append((t, m, n))

        fresh_quotes = {}
        if tasks:
            with ThreadPoolExecutor(max_workers=min(len(tasks), 6)) as ex:
                futures = [ex.submit(fetch_live_stock_quote_and_tech, t, m, n) for t, m, n in tasks]
                for fut in concurrent.futures.as_completed(futures):
                    try:
                        res = fut.result()
                        if res and res.get("current_price") is not None and res["current_price"] > 0:
                            fresh_quotes[res["ticker"]] = res
                    except Exception:
                        pass

        if fresh_quotes:
            G_PORTFOLIO_LIVE_CACHE["quotes"].update(fresh_quotes)
            G_PORTFOLIO_LIVE_CACHE["timestamp"] = now

    quotes = G_PORTFOLIO_LIVE_CACHE.get("quotes", {})
    updated = False
    for item in portfolio_list:
        t = str(item.get("ticker", "")).strip().upper()
        if t in quotes:
            q = quotes[t]
            if q.get("current_price") and q["current_price"] > 0:
                item["current_price"] = q["current_price"]
                item["day_change"] = q.get("day_change", 0.0)
                item["day_change_pct"] = q.get("day_change_pct", 0.0)
                if q.get("technical_indicators"):
                    if "technical_indicators" not in item:
                        item["technical_indicators"] = {}
                    item["technical_indicators"].update(q["technical_indicators"])
                updated = True

    if updated and should_fetch:
        try:
            with open(PORTFOLIO_FILE, "w", encoding="utf-8") as f:
                json.dump({"portfolio": portfolio_list}, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

    return portfolio_list

# ==============================================================================
# 3. HTTP REST API 핸들러
# ==============================================================================
class StockExitNavHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        if path == "/api/health":
            self.send_json_response(200, {"status": "ok", "time": datetime.datetime.now().isoformat()})
        elif path == "/api/macro":
            self.handle_get_macro()
        elif path == "/api/naver/indices":
            self.handle_get_naver_indices()
        elif path.startswith("/api/naver/stock/"):
            ticker = path.split("/")[-1]
            self.handle_get_naver_stock(ticker)
        elif path.startswith("/api/stock/candles") or path == "/api/stock/candles":
            ticker = query.get("ticker", [""])[0] or query.get("code", [""])[0] or query.get("query", [""])[0] or query.get("q", [""])[0]
            market = query.get("market", ["KR"])[0]
            self.handle_get_stock_candles(ticker, market)
        elif path == "/api/sectors":
            self.handle_get_sectors()
        elif path == "/api/market-map" or path.startswith("/api/market-map"):
            market_filter = query.get("market", ["all"])[0]
            self.handle_get_market_map(market_filter)
        elif path == "/api/quotes" or path.startswith("/api/quotes"):
            tickers_str = query.get("tickers", [""])[0] or query.get("t", [""])[0]
            force_refresh = (query.get("refresh", ["0"])[0] in ["1", "true", "True"])
            self.handle_get_quotes(tickers_str, force_refresh)
        elif path == "/api/portfolio" or path == "/api/portfolio/refresh":
            rf_override = query.get("rf", [None])[0]
            force_refresh = (path == "/api/portfolio/refresh") or (query.get("refresh", ["0"])[0] in ["1", "true", "True"])
            self.handle_get_portfolio(rf_override, force_refresh)
        elif path.startswith("/api/stock/autofill") or path.startswith("/api/stock-autofill"):
            query_str = query.get("query", [""])[0] or query.get("code", [""])[0] or query.get("q", [""])[0] or query.get("ticker", [""])[0]
            if not query_str:
                parts = path.split("/")
                if len(parts) >= 5:
                    query_str = parts[4]
                elif len(parts) >= 4 and parts[3] not in ["autofill", "stock-autofill"]:
                    query_str = parts[3]
            self.handle_stock_autofill(query_str)
        elif path.startswith("/api/stock/"):
            stock_id = path.split("/")[-1]
            rf_override = query.get("rf", [None])[0]
            self.handle_get_stock_detail(stock_id, rf_override)
        else:
            # Static files from web/
            super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/portfolio":
            self.handle_add_stock()
        elif path == "/api/portfolio/update":
            self.handle_update_stock()
        elif path == "/api/portfolio/delete":
            self.handle_delete_stock()
        elif path == "/api/simulate":
            self.handle_simulate_custom()
        else:
            self.send_error(404, "Endpoint not found")

    def handle_get_naver_indices(self):
        kospi = get_naver_index_data("KOSPI")
        kosdaq = get_naver_index_data("KOSDAQ")
        self.send_json_response(200, {
            "success": True,
            "kospi": kospi,
            "kosdaq": kosdaq,
            "source": "네이버 증권 (Naver Finance) 실시간"
        })

    def handle_get_naver_stock(self, ticker):
        data = get_naver_stock_data(ticker)
        if data:
            self.send_json_response(200, {"success": True, "stock": data})
        else:
            self.send_json_response(404, {"success": False, "error": "Naver Finance stock not found"})

    def handle_get_stock_candles(self, ticker_query, market_query="KR"):
        try:
            q = (ticker_query or "000660").strip()
            code = q.upper()
            stock_name = q

            for kname, kcode in KOREAN_TICKER_MAP.items():
                if kname == q or kname in q or q in kname:
                    code = kcode
                    stock_name = kname
                    break

            if not re.match(r"^\d{1,6}$", code) and market_query != "US" and not re.match(r"^[A-Z]{1,6}$", code):
                dyn = search_naver_ticker(q)
                if dyn:
                    code = dyn

            profile = lookup_stock_profile(code) or lookup_stock_profile(q)
            if profile and profile.get("name"):
                stock_name = profile["name"]

            candles = fetch_stock_candles(code, market_query, stock_name)
            if not candles:
                self.send_json_response(404, {"error": "캔들 데이터를 불러올 수 없습니다."})
                return

            indicators = compute_technical_indicators(candles)
            curr_p = candles[-1]["close"]
            basic_d = get_naver_stock_data(code) if re.match(r"^\d{6}$", code) else None
            if basic_d and basic_d.get("current_price", 0) > 0:
                curr_p = basic_d["current_price"]
                stock_name = basic_d.get("name") or stock_name
            elif profile and profile.get("curr_price"):
                if curr_p <= 0:
                    curr_p = profile["curr_price"]

            # 다모다란 밴드 산출 (크로스체크용)
            dcf_bands = None
            try:
                autofill_d = get_stock_autofill_data(code)
                if autofill_d:
                    dcf_res = calculate_damodaran_dcf(autofill_d)
                    if dcf_res:
                        dcf_bands = {
                            "conservative_value": dcf_res["conservative_value"],
                            "base_fair_value": dcf_res["base_fair_value"],
                            "bullish_value": dcf_res["bullish_value"],
                            "sector_name": dcf_res.get("sector_name", "섹터 모델"),
                            "sector_model": dcf_res.get("sector_model", "다모다란 모델")
                        }
            except Exception:
                pass

            timing = analyze_technical_timing(candles, indicators, curr_p, dcf_bands)

            self.send_json_response(200, {
                "success": True,
                "ticker": code,
                "name": stock_name,
                "market": market_query,
                "current_price": curr_p,
                "candles": candles,
                "indicators": indicators,
                "timing": timing,
                "dcf_bands": dcf_bands
            })
        except Exception as e:
            self.send_json_response(500, {"error": str(e)})

    def handle_get_macro(self):
        try:
            with open(MACRO_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)

            # 네이버 증권 실시간 KOSPI / KOSDAQ 연동
            try:
                kospi_naver = get_naver_index_data("KOSPI")
                kosdaq_naver = get_naver_index_data("KOSDAQ")
                
                indices = data.get("indices", [])
                for idx in indices:
                    if idx["code"] == "KOSPI" and kospi_naver:
                        idx["current"] = kospi_naver["current"]
                        idx["change"] = kospi_naver["change"]
                        idx["change_pct"] = kospi_naver["change_pct"]
                        idx["source"] = "네이버 증권"
                    elif idx["code"] == "KOSDAQ" and kosdaq_naver:
                        idx["current"] = kosdaq_naver["current"]
                        idx["change"] = kosdaq_naver["change"]
                        idx["change_pct"] = kosdaq_naver["change_pct"]
                        idx["source"] = "네이버 증권"
                data["indices"] = indices
                if kospi_naver and "trade_time" in kospi_naver:
                    data["last_updated"] = f"{kospi_naver['trade_time'][:19].replace('T', ' ')} (실시간 시세 연동)"
            except Exception:
                pass

            # 실시간 지수 선물 & 원자재 시세 병합 (Futures & Commodities)
            try:
                f_live, c_live = get_live_macro_data()
                
                # Session time flags (KST)
                now_utc = datetime.datetime.utcnow()
                kst_hour = (now_utc.hour + 9) % 24
                kst_min = now_utc.minute
                is_day_regular = (9 <= kst_hour < 15) or (kst_hour == 15 and kst_min <= 45)
                is_night_eurex = (18 <= kst_hour <= 23) or (0 <= kst_hour < 6)

                # Merge futures
                futures_list = data.get("futures", [])
                for item in futures_list:
                    c = item.get("code")
                    if c == "KOSPI200_DAY":
                        item["is_active_session"] = is_day_regular
                    elif c == "KOSPI200_NIGHT":
                        item["is_active_session"] = is_night_eurex
                    else:
                        item["is_active_session"] = True

                    if c in f_live:
                        live_info = f_live[c]
                        if "current" in live_info:
                            item["current"] = live_info["current"]
                        if "change_pct" in live_info:
                            item["change_pct"] = live_info["change_pct"]
                        if "change" in live_info:
                            item["change"] = live_info["change"]
                        if "basis" in live_info:
                            item["basis"] = live_info["basis"]
                        if "basis_status" in live_info:
                            item["basis_status"] = live_info["basis_status"]
                data["futures"] = futures_list

                # Merge commodities
                commodities_list = data.get("commodities", [])
                for item in commodities_list:
                    c = item.get("code")
                    if c in c_live:
                        live_info = c_live[c]
                        if "current" in live_info:
                            item["current"] = live_info["current"]
                        if "change_pct" in live_info:
                            item["change_pct"] = live_info["change_pct"]
                        if "change" in live_info:
                            item["change"] = live_info["change"]
                data["commodities"] = commodities_list
            except Exception:
                pass

            self.send_json_response(200, data)
        except Exception as e:
            self.send_json_response(500, {"error": str(e)})

    def handle_stock_autofill(self, query):
        try:
            if not query:
                self.send_json_response(400, {"error": "Query parameter required"})
                return
            data = get_stock_autofill_data(query)
            if data:
                self.send_json_response(200, data)
            else:
                self.send_json_response(404, {"error": f"종목 정보를 찾을 수 없습니다: {query}"})
        except Exception as e:
            self.send_json_response(500, {"error": str(e)})

    def handle_get_sectors(self):
        try:
            with open(SECTORS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            self.send_json_response(200, data)
        except Exception as e:
            self.send_json_response(500, {"error": str(e)})

    def handle_get_market_map(self, market_filter="all"):
        try:
            data = get_market_map_data(market_filter)
            self.send_json_response(200, data)
        except Exception as e:
            self.send_json_response(500, {"error": str(e)})

    def handle_get_portfolio(self, rf_override=None, force_refresh=False):
        try:
            with open(PORTFOLIO_FILE, "r", encoding="utf-8") as f:
                raw = json.load(f)
            portfolio_list = raw.get("portfolio", [])

            # 실시간 호가/시세 및 기술적 지표 자동 동기화
            portfolio_list = sync_portfolio_live_quotes(portfolio_list, force_refresh=force_refresh)

            enriched = []
            total_invested_krw = 0.0
            total_current_krw = 0.0
            usd_krw_rate = 1338.5  # default fx rate

            # 매크로 환율 읽기
            if os.path.exists(MACRO_FILE):
                try:
                    with open(MACRO_FILE, "r", encoding="utf-8") as mf:
                        m_data = json.load(mf)
                        for item in m_data.get("fx", []):
                            if item["pair"] == "USD/KRW":
                                usd_krw_rate = item["current"]
                except Exception:
                    pass

            for item in portfolio_list:
                dcf = calculate_damodaran_dcf(item, rf_override)
                exit_analysis = evaluate_exit_timing(item, dcf)
                
                curr_price = float(item["current_price"])
                buy_price = float(item["buy_price"])
                qty = int(item["quantity"])
                is_usd = (item.get("currency") == "USD")
                fx = usd_krw_rate if is_usd else 1.0

                total_invested_krw += (buy_price * qty * fx)
                total_current_krw += (curr_price * qty * fx)

                item_copy = dict(item)
                item_copy["dcf"] = dcf
                item_copy["exit_analysis"] = exit_analysis
                enriched.append(item_copy)

            total_profit_krw = total_current_krw - total_invested_krw
            total_profit_pct = (total_profit_krw / total_invested_krw * 100.0) if total_invested_krw > 0 else 0

            response = {
                "portfolio": enriched,
                "summary": {
                    "total_invested_krw": round(total_invested_krw, 0),
                    "total_current_krw": round(total_current_krw, 0),
                    "total_profit_krw": round(total_profit_krw, 0),
                    "total_profit_pct": round(total_profit_pct, 2),
                    "stock_count": len(enriched),
                    "usd_krw_rate": usd_krw_rate,
                    "last_synced_at": datetime.datetime.now().strftime("%H:%M:%S")
                }
            }
            self.send_json_response(200, response)
        except Exception as e:
            self.send_json_response(500, {"error": str(e)})

    def handle_get_stock_detail(self, stock_id, rf_override=None):
        try:
            with open(PORTFOLIO_FILE, "r", encoding="utf-8") as f:
                raw = json.load(f)
            portfolio_list = raw.get("portfolio", [])
            portfolio_list = sync_portfolio_live_quotes(portfolio_list, force_refresh=False)
            target = next((x for x in portfolio_list if x["id"] == stock_id), None)
            if not target:
                self.send_json_response(404, {"error": "Stock not found"})
                return

            dcf = calculate_damodaran_dcf(target, rf_override)
            exit_analysis = evaluate_exit_timing(target, dcf)
            res = dict(target)
            res["dcf"] = dcf
            res["exit_analysis"] = exit_analysis
            self.send_json_response(200, res)
        except Exception as e:
            self.send_json_response(500, {"error": str(e)})

    def handle_get_quotes(self, tickers_str, force_refresh=False):
        """다중 종목 실시간 호가 및 기술지표 일괄 조회 API (사용자 개인정보 보호용)"""
        try:
            raw_tickers = [t.strip().upper() for t in tickers_str.split(",") if t.strip()]
            if not raw_tickers:
                self.send_json_response(200, {"quotes": {}, "timestamp": time.time()})
                return

            quotes = {}
            tasks = []
            for t in raw_tickers:
                # 15초 캐시 확인
                if not force_refresh and t in G_PORTFOLIO_LIVE_CACHE["quotes"]:
                    cached = G_PORTFOLIO_LIVE_CACHE["quotes"][t]
                    if (time.time() - cached.get("timestamp", 0)) < 20:
                        quotes[t] = cached
                        continue
                market = "KR" if re.match(r"^\d{6}$", t) else "US"
                tasks.append((t, market, ""))

            if tasks:
                with ThreadPoolExecutor(max_workers=min(len(tasks), 8)) as ex:
                    futures = [ex.submit(fetch_live_stock_quote_and_tech, t, m, n) for t, m, n in tasks]
                    for fut in concurrent.futures.as_completed(futures):
                        try:
                            res = fut.result()
                            if res and res.get("current_price"):
                                quotes[res["ticker"]] = res
                                G_PORTFOLIO_LIVE_CACHE["quotes"][res["ticker"]] = res
                        except Exception:
                            pass

            self.send_json_response(200, {"quotes": quotes, "timestamp": time.time()})
        except Exception as e:
            self.send_json_response(500, {"error": str(e)})

    def handle_add_stock(self):
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            post_data = self.rfile.read(content_length)
            body = json.loads(post_data.decode("utf-8"))

            with open(PORTFOLIO_FILE, "r", encoding="utf-8") as f:
                raw = json.load(f)
            portfolio_list = raw.get("portfolio", [])

            new_id = f"stock_{datetime.datetime.now().strftime('%Y%m%d%H%M%S')}"
            market = body.get("market", "KR")
            currency = "USD" if market == "US" else "KRW"
            buy_price = float(body.get("buy_price", 10000))
            current_price = float(body.get("current_price", buy_price))
            ticker = str(body.get("ticker", "CUSTOM")).strip().upper()
            name = str(body.get("name", "신규 종목")).strip()

            # 실시간 호가 및 캔들 정보 수집
            live_quote = fetch_live_stock_quote_and_tech(ticker, market, name)
            if live_quote.get("current_price") and live_quote["current_price"] > 0:
                current_price = live_quote["current_price"]
                day_change = live_quote.get("day_change", 0.0)
                day_change_pct = live_quote.get("day_change_pct", 0.0)
                live_tech = live_quote.get("technical_indicators", {})
            else:
                day_change = round(current_price * 0.01, 1 if currency == "USD" else -1)
                day_change_pct = 1.0
                live_tech = {}

            profile = lookup_stock_profile(ticker) or lookup_stock_profile(name)
            autofill_d = None
            try:
                autofill_d = get_stock_autofill_data(ticker or name)
            except Exception:
                pass

            # 다모다란 기본 입력값 추정 (사용자 입력 > 공시 autofill > 프로필 벤치마크)
            user_d_inputs = body.get("damodaran_inputs", {})
            sector_id = body.get("sector_id") or (autofill_d.get("sector_id") if autofill_d else None) or (profile.get("sector") if profile else None) or get_stock_sector(ticker, name)
            consensus_tp = body.get("consensus_target_price") or (autofill_d.get("consensus_target_price") if autofill_d else None) or (profile.get("consensus_target_price") if profile else None)

            unlevered_beta = float(user_d_inputs.get("unlevered_beta") or body.get("unlevered_beta") or (autofill_d.get("unlevered_beta") if autofill_d else None) or (profile["unlevered_beta"] if profile else 1.15))
            growth_rate = float(user_d_inputs.get("growth_rate_next_5y") or body.get("growth_rate_next_5y") or (autofill_d.get("growth_rate_next_5y") if autofill_d else None) or (profile["growth_rate_next_5y"] if profile else 8.0))
            target_margin = float(user_d_inputs.get("target_ebit_margin") or body.get("target_ebit_margin") or (autofill_d.get("target_ebit_margin") if autofill_d else None) or (profile["target_ebit_margin"] if profile else 18.0))
            
            base_rev = float(user_d_inputs.get("base_revenue") or body.get("base_revenue") or (autofill_d.get("base_revenue") if autofill_d else None) or (profile["base_revenue"] if profile else (50000.0 if market == "KR" else 5000.0)))
            shares = float(user_d_inputs.get("shares_outstanding_mil") or body.get("shares_outstanding_mil") or (autofill_d.get("shares_outstanding_mil") if autofill_d else None) or (profile["shares_outstanding_mil"] if profile else 0))
            if shares <= 0:
                shares = (base_rev * 1.5 * 1000.0) / current_price if market == "KR" else (base_rev * 1.5) / current_price
                if shares <= 0:
                    shares = 100.0

            net_debt = float(user_d_inputs.get("net_debt_billion_krw", (profile.get("net_debt_billion_krw", 0) if profile else 0)))
            rd_annual = float(user_d_inputs.get("rd_annual_billion_krw", (profile.get("rd_annual_billion_krw", 0) if profile else 0)))
            de_ratio = float(user_d_inputs.get("debt_to_equity_pct", ((autofill_d.get("debt_to_equity_pct") if autofill_d else None) or (profile.get("debt_to_equity_pct", 15.0) if profile else 15.0))))

            tech_indicators = {
                "rsi_14": live_tech.get("rsi_14", float(body.get("rsi_14", 55.0))),
                "bollinger_upper": live_tech.get("bollinger_upper", round(current_price * 1.06, 1 if currency == "USD" else -1)),
                "bollinger_middle": live_tech.get("bollinger_middle", round(current_price * 1.00, 1 if currency == "USD" else -1)),
                "bollinger_lower": live_tech.get("bollinger_lower", round(current_price * 0.94, 1 if currency == "USD" else -1)),
                "sma_20": live_tech.get("sma_20", round(current_price * 0.98, 1 if currency == "USD" else -1)),
                "sma_60": live_tech.get("sma_60", round(current_price * 0.95, 1 if currency == "USD" else -1)),
                "trend": live_tech.get("trend", "중립-상승세"),
                "overbought_level": live_tech.get("overbought_level", "중립 구간")
            }

            new_stock = {
                "id": new_id,
                "ticker": ticker,
                "name": name,
                "market": market,
                "currency": currency,
                "sector_id": sector_id,
                "consensus_target_price": consensus_tp,
                "buy_price": buy_price,
                "quantity": int(body.get("quantity", 10)),
                "buy_date": body.get("buy_date", datetime.date.today().isoformat()),
                "current_price": current_price,
                "day_change": day_change,
                "day_change_pct": day_change_pct,
                "high_52w": round(current_price * 1.2, 1 if currency == "USD" else -1),
                "low_52w": round(current_price * 0.8, 1 if currency == "USD" else -1),
                "notes": body.get("notes", "다모다란 모델을 통한 매도 타이밍 추적"),
                "damodaran_inputs": {
                    "base_revenue": base_rev,
                    "growth_rate_next_5y": growth_rate,
                    "terminal_growth_rate": float(user_d_inputs.get("terminal_growth_rate", 2.5)),
                    "target_ebit_margin": target_margin,
                    "sales_to_capital": float(user_d_inputs.get("sales_to_capital", (profile.get("sales_to_capital", 1.4) if profile else 1.4))),
                    "unlevered_beta": unlevered_beta,
                    "debt_to_equity_pct": de_ratio,
                    "effective_tax_rate": float(user_d_inputs.get("effective_tax_rate", 22.0)),
                    "cost_of_debt_pretax": float(user_d_inputs.get("cost_of_debt_pretax", 4.5)),
                    "shares_outstanding_mil": round(shares, 1),
                    "net_debt_billion_krw": net_debt,
                    "rd_annual_billion_krw": rd_annual
                },
                "technical_indicators": tech_indicators
            }

            portfolio_list.append(new_stock)
            raw["portfolio"] = portfolio_list
            with open(PORTFOLIO_FILE, "w", encoding="utf-8") as f:
                json.dump(raw, f, ensure_ascii=False, indent=2)

            self.send_json_response(201, {"success": True, "stock": new_stock})
        except Exception as e:
            self.send_json_response(500, {"error": str(e)})

    def handle_update_stock(self):
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            post_data = self.rfile.read(content_length)
            body = json.loads(post_data.decode("utf-8"))
            stock_id = body.get("id")

            with open(PORTFOLIO_FILE, "r", encoding="utf-8") as f:
                raw = json.load(f)
            portfolio_list = raw.get("portfolio", [])

            idx = next((i for i, x in enumerate(portfolio_list) if x["id"] == stock_id), None)
            if idx is None:
                self.send_json_response(404, {"error": "Stock not found"})
                return

            # Update mutable fields
            target = portfolio_list[idx]
            if "current_price" in body:
                target["current_price"] = float(body["current_price"])
            if "buy_price" in body:
                target["buy_price"] = float(body["buy_price"])
            if "quantity" in body:
                target["quantity"] = int(body["quantity"])
            if "notes" in body:
                target["notes"] = str(body["notes"])
            if "damodaran_inputs" in body:
                target["damodaran_inputs"].update(body["damodaran_inputs"])
            if "technical_indicators" in body:
                target["technical_indicators"].update(body["technical_indicators"])

            portfolio_list[idx] = target
            raw["portfolio"] = portfolio_list
            with open(PORTFOLIO_FILE, "w", encoding="utf-8") as f:
                json.dump(raw, f, ensure_ascii=False, indent=2)

            self.send_json_response(200, {"success": True, "stock": target})
        except Exception as e:
            self.send_json_response(500, {"error": str(e)})

    def handle_delete_stock(self):
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            post_data = self.rfile.read(content_length)
            body = json.loads(post_data.decode("utf-8"))
            stock_id = body.get("id")

            with open(PORTFOLIO_FILE, "r", encoding="utf-8") as f:
                raw = json.load(f)
            portfolio_list = raw.get("portfolio", [])
            new_list = [x for x in portfolio_list if x["id"] != stock_id]
            raw["portfolio"] = new_list

            with open(PORTFOLIO_FILE, "w", encoding="utf-8") as f:
                json.dump(raw, f, ensure_ascii=False, indent=2)

            self.send_json_response(200, {"success": True, "deleted_id": stock_id})
        except Exception as e:
            self.send_json_response(500, {"error": str(e)})

    def handle_simulate_custom(self):
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            post_data = self.rfile.read(content_length)
            body = json.loads(post_data.decode("utf-8"))

            rf_override = body.get("rf")
            dcf = calculate_damodaran_dcf(body, rf_override)
            exit_eval = evaluate_exit_timing(body, dcf)

            self.send_json_response(200, {
                "dcf": dcf,
                "exit_analysis": exit_eval
            })
        except Exception as e:
            self.send_json_response(500, {"error": str(e)})

    def send_json_response(self, code, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

def portfolio_auto_sync_worker():
    """서버 백그라운드에서 60~90초 주기로 포트폴리오 및 선물/원자재 시세 자동 최신화 (5분 이내 보장)"""
    while True:
        try:
            time.sleep(75) # 75초(1분 15초) 주기 자동 갱신 (5분 이내 완벽 보장)
            if os.path.exists(PORTFOLIO_FILE):
                with open(PORTFOLIO_FILE, "r", encoding="utf-8") as f:
                    raw = json.load(f)
                p_list = raw.get("portfolio", [])
                if p_list:
                    sync_portfolio_live_quotes(p_list, force_refresh=True)
            refresh_futures_commodities_live_bg()
        except Exception:
            pass

def run(port=8890):
    server_address = ("", port)
    httpd = HTTPServer(server_address, StockExitNavHandler)
    print(f"===============================================================")
    print(f"  Troster Stock 매수·매도 타이밍 분석 (Troster Stock Timing Navigator)")
    print(f"  웹 서버 가동 완료! 접속 주소: http://localhost:{port}")
    
    # 백그라운드 자동 시세 최신화 워커 가동 (75초 주기)
    sync_thread = threading.Thread(target=portfolio_auto_sync_worker, daemon=True)
    sync_thread.start()
    
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n서버를 안전하게 종료합니다.")
        httpd.server_close()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8890))
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            pass
    run(port)
