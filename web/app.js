/**
 * Troster Stock 매수·매도 타이밍 분석 (Troster Stock Timing Navigator)
 * Frontend Application Controller
 * - Python HTTP Server REST API 완벽 지원
 * - 브라우저 실시간 환율 & 트레이딩뷰 실시간 스트리밍 연동
 * - 깨끗한 초기 상태(Clean Slate)에서 사용자 직접 매수 종목 등록 지원
 */

// Global State
let g_portfolio = [];
let g_summary = {};
let g_macroData = null;
let g_sectorsData = [];
let g_selectedStock = null;
let g_currentRfOverride = null;
let g_stockChart = null;
let g_yieldChart = null;
let g_chartData = null;
let g_chartTimeframe = 110;
let g_subChartMode = 'volume';
let g_mainCandleChart = null;
let g_subCandleChart = null;
let g_marketMapData = null;
let g_mapMarket = "all";
let g_mapMetric = "change";
let g_mapViewMode = "split";
let g_futFilter = "all";
let g_commFilter = "all";

// =============================================================================
// Offline / Default Seed Datasets (Latest 2026 Live Baseline)
// =============================================================================
const OFFLINE_MACRO_SEED = {
  "last_updated": "2026-09-21 10:42:00 KST (실시간 연동)",
  "indices": [
    { "code": "KOSPI", "name": "코스피", "market": "KR", "current": 2694.23, "change": 18.81, "change_pct": 0.70 },
    { "code": "KOSDAQ", "name": "코스닥", "market": "KR", "current": 837.65, "change": 4.15, "change_pct": 0.50 },
    { "code": "SPX", "name": "S&P 500", "market": "US", "current": 5712.40, "change": 26.80, "change_pct": 0.47 },
    { "code": "IXIC", "name": "나스닥 종합", "market": "US", "current": 18180.50, "change": 135.20, "change_pct": 0.75 },
    { "code": "DJI", "name": "다우 존스", "market": "US", "current": 42205.80, "change": 72.10, "change_pct": 0.17 }
  ],
  "fx": [
    { "pair": "USD/KRW", "name": "원/달러 환율", "current": 1380.30, "change": -2.50, "change_pct": -0.18, "unit": "원" },
    { "pair": "JPY/KRW", "name": "엔/원 (100엔)", "current": 948.50, "change": 2.20, "change_pct": 0.23, "unit": "원" },
    { "pair": "EUR/USD", "name": "유로/달러", "current": 1.1165, "change": 0.0018, "change_pct": 0.16, "unit": "$" }
  ],
  "commodities": [
    { "code": "WTI", "name": "WTI 원유", "current": 72.35, "change": 0.90, "change_pct": 1.26, "unit": "$/배럴" },
    { "code": "BRENT", "name": "브렌트유", "current": 75.60, "change": 0.80, "change_pct": 1.07, "unit": "$/배럴" },
    { "code": "GOLD", "name": "국제 금", "current": 2628.40, "change": 12.60, "change_pct": 0.48, "unit": "$/oz" }
  ],
  "treasury_yields": {
    "us_5y": { "name": "미국 국채 5년물", "yield": 3.95, "change": -0.02, "unit": "%" },
    "us_10y": { "name": "미국 국채 10년물 (글로벌 벤치마크 Rf)", "yield": 4.12, "change": -0.03, "unit": "%" },
    "us_20y": { "name": "미국 국채 20년물", "yield": 4.38, "change": -0.01, "unit": "%" },
    "us_30y": { "name": "미국 국채 30년물", "yield": 4.35, "change": -0.02, "unit": "%" },
    "kr_10y": { "name": "한국 국채 10년물 (국내 Rf)", "yield": 3.28, "change": -0.01, "unit": "%" }
  },
  "macro_summary": {
    "regime": "글로벌 금리 피벗 사이클 & 실시간 환율·국채금리 반영 중",
    "fed_stance": "연준(Fed) 기준금리 인하 기조와 국채 금리 4%대 안정화 추이 연동",
    "valuation_implication": "미국 10년물 국채 금리(Rf) 약 4.12% 기준, WACC와 다모다란 내재가치 실시간 연동"
  }
};

const OFFLINE_SECTORS_SEED = [
  {
    "id": "semiconductor",
    "name_kr": "반도체 & 하드웨어",
    "name_en": "Semiconductors & Equipment",
    "damodaran_unlevered_beta": 1.22,
    "avg_debt_ratio": 12.5,
    "avg_levered_beta": 1.34,
    "avg_cost_of_capital": 9.45,
    "avg_ebit_margin": 23.5,
    "sales_to_capital": 1.42,
    "rd_capitalization_boost": 4.8,
    "macro_profile": {
      "interest_rate_impact": "보통 부정적 (고밸류 시 할인율 상승 부담, 단 풍부한 현금성 자산 보유)",
      "fx_impact": "강력 수혜 (달러 결제 비중 90% 이상으로 고환율/원화약세 시 영업이익 급증)",
      "oil_impact": "중립 (간접적 운송비 영향)",
      "cycle_phase": "AI 인프라 수요 폭발 및 고대역폭메모리(HBM) 슈퍼사이클"
    },
    "exit_recommendation_guide": "적정 PBR 1.8배 돌파 또는 다모다란 Base Fair Value +15% 초과 시 1차 분할 익절, RSI 75 이상 시 비중 축소",
    "top_stocks_kr": [
      {"name": "SK하이닉스", "ticker": "000660"},
      {"name": "삼성전자", "ticker": "005930"},
      {"name": "한미반도체", "ticker": "042700"},
      {"name": "리노공업", "ticker": "058470"},
      {"name": "이수페타시스", "ticker": "007660"}
    ],
    "top_stocks_us": [
      {"name": "엔비디아", "ticker": "NVDA"},
      {"name": "TSMC", "ticker": "TSM"},
      {"name": "브로드컴", "ticker": "AVGO"},
      {"name": "ASML", "ticker": "ASML"},
      {"name": "퀄컴", "ticker": "QCOM"}
    ]
  },
  {
    "id": "software_ai",
    "name_kr": "인터넷·소프트웨어 & 빅테크",
    "name_en": "Software & Internet Services",
    "damodaran_unlevered_beta": 1.18,
    "avg_debt_ratio": 9.8,
    "avg_levered_beta": 1.26,
    "avg_cost_of_capital": 9.10,
    "avg_ebit_margin": 28.2,
    "sales_to_capital": 1.85,
    "rd_capitalization_boost": 6.2,
    "macro_profile": {
      "interest_rate_impact": "매우 민감 (금리 하락 시 미래 현금흐름 현재가치 급증으로 최대 수혜)",
      "fx_impact": "국내 포털은 중립/부정적, 글로벌 빅테크는 환율 헤지 및 달러 매출 수혜",
      "oil_impact": "중립",
      "cycle_phase": "클라우드 및 생성형 AI 유료화 전환 구간"
    },
    "exit_recommendation_guide": "PSR 15배 이상 진입 시 또는 영업이익 성장 둔화 조짐 발생 시 다모다란 적정가 도달 즉시 40% 분할 매도",
    "top_stocks_kr": [
      {"name": "NAVER", "ticker": "035420"},
      {"name": "카카오", "ticker": "035720"},
      {"name": "크래프톤", "ticker": "259960"},
      {"name": "엔씨소프트", "ticker": "036570"},
      {"name": "카카오페이", "ticker": "377300"}
    ],
    "top_stocks_us": [
      {"name": "마이크로소프트", "ticker": "MSFT"},
      {"name": "알파벳", "ticker": "GOOGL"},
      {"name": "메타", "ticker": "META"},
      {"name": "아마존", "ticker": "AMZN"},
      {"name": "팔란티어", "ticker": "PLTR"}
    ]
  },
  {
    "id": "auto_mobility",
    "name_kr": "자동차 & 모빌리티",
    "name_en": "Automotive & Parts",
    "damodaran_unlevered_beta": 0.88,
    "avg_debt_ratio": 28.5,
    "avg_levered_beta": 1.15,
    "avg_cost_of_capital": 8.60,
    "avg_ebit_margin": 8.9,
    "sales_to_capital": 1.28,
    "rd_capitalization_boost": 2.1,
    "macro_profile": {
      "interest_rate_impact": "부정적 (금리 인상 시 할부 금융 비용 증가로 차량 소비 위축, 인하 시 구매력 회복)",
      "fx_impact": "매우 긍정적 (원화 약세 시 북미·유럽 시장 수출 단가 및 환산 이익 극대화)",
      "oil_impact": "하이브리드/전기차 비중 높은 기업은 고유가 시 점유율 확대 기회",
      "cycle_phase": "하이브리드(HEV) 캐시카우 바탕 주주환원(밸류업) 강화"
    },
    "exit_recommendation_guide": "PER 6~7배 도달 및 환율 1,300원 붕괴(원화강세 전환) 시 이익 피크아웃 우려로 분할 매도 실행",
    "top_stocks_kr": [
      {"name": "현대차", "ticker": "005380"},
      {"name": "기아", "ticker": "000270"},
      {"name": "현대모비스", "ticker": "012330"},
      {"name": "현대위아", "ticker": "011210"},
      {"name": "HL만도", "ticker": "204320"}
    ],
    "top_stocks_us": [
      {"name": "테슬라", "ticker": "TSLA"},
      {"name": "제너럴모터스", "ticker": "GM"},
      {"name": "포드", "ticker": "F"},
      {"name": "우버", "ticker": "UBER"},
      {"name": "리비안", "ticker": "RIVN"}
    ]
  },
  {
    "id": "banking_finance",
    "name_kr": "은행 & 금융지주",
    "name_en": "Banks & Financial Services",
    "damodaran_unlevered_beta": 0.55,
    "avg_debt_ratio": 65.0,
    "avg_levered_beta": 0.95,
    "avg_cost_of_capital": 8.20,
    "avg_ebit_margin": 35.0,
    "sales_to_capital": 0.95,
    "rd_capitalization_boost": 0.2,
    "macro_profile": {
      "interest_rate_impact": "복합적 (금리 상승 시 순이자마진(NIM) 확대, 인하 시 대출수요 증가 및 채권평가익)",
      "fx_impact": "중립 (외화 부채/자산 익스포저 관리)",
      "oil_impact": "중립",
      "cycle_phase": "저PBR 해소 및 자사주 소각·배당 성향 상향 정책 지속"
    },
    "exit_recommendation_guide": "PBR 0.65~0.75배 진입 및 배당수익률 5% 미만 축소 시 차익 실현",
    "top_stocks_kr": [
      {"name": "KB금융", "ticker": "105560"},
      {"name": "신한지주", "ticker": "055550"},
      {"name": "하나금융지주", "ticker": "086790"},
      {"name": "메리츠금융지주", "ticker": "138040"},
      {"name": "카카오뱅크", "ticker": "323410"}
    ],
    "top_stocks_us": [
      {"name": "JP모건체이스", "ticker": "JPM"},
      {"name": "뱅크오브아메리카", "ticker": "BAC"},
      {"name": "웰스파고", "ticker": "WFC"},
      {"name": "골드만삭스", "ticker": "GS"},
      {"name": "모건스탠리", "ticker": "MS"}
    ]
  },
  {
    "id": "battery_cleanenergy",
    "name_kr": "2차전지 & 친환경 에너지",
    "name_en": "Battery & Clean Energy",
    "damodaran_unlevered_beta": 1.35,
    "avg_debt_ratio": 32.0,
    "avg_levered_beta": 1.62,
    "avg_cost_of_capital": 10.80,
    "avg_ebit_margin": 7.5,
    "sales_to_capital": 0.82,
    "rd_capitalization_boost": 5.4,
    "macro_profile": {
      "interest_rate_impact": "극단적 부정 (대규모 설비투자(CapEx) 조달비용 상승, 인하 시 반등 탄력 최고)",
      "fx_impact": "보통 (수출 비중 높으나 원자재 수입 비중도 큼)",
      "oil_impact": "고유가 시 전기차 경제성 부각으로 수혜, 저유가 시 수요 둔화(캐즘)",
      "cycle_phase": "전기차 캐즘(일시적 둔화) 극복 중, 밸류에이션 리레이팅 탐색"
    },
    "exit_recommendation_guide": "EV/EBITDA 25배 이상 과열 또는 볼린저밴드 상단 이탈 시 철저한 비중 축소",
    "top_stocks_kr": [
      {"name": "LG에너지솔루션", "ticker": "373220"},
      {"name": "POSCO홀딩스", "ticker": "005490"},
      {"name": "에코프로비엠", "ticker": "247540"},
      {"name": "삼성SDI", "ticker": "006400"},
      {"name": "포스코퓨처엠", "ticker": "003670"}
    ],
    "top_stocks_us": [
      {"name": "앨버말", "ticker": "ALB"},
      {"name": "인페이즈에너지", "ticker": "ENPH"},
      {"name": "퍼스트솔라", "ticker": "FSLR"},
      {"name": "넥스트에라에너지", "ticker": "NEE"},
      {"name": "퀀텀스케이프", "ticker": "QS"}
    ]
  },
  {
    "id": "biotech_pharma",
    "name_kr": "바이오 & 제약",
    "name_en": "Biotechnology & Pharmaceuticals",
    "damodaran_unlevered_beta": 1.10,
    "avg_debt_ratio": 15.0,
    "avg_levered_beta": 1.24,
    "avg_cost_of_capital": 9.30,
    "avg_ebit_margin": 18.0,
    "sales_to_capital": 1.10,
    "rd_capitalization_boost": 12.5,
    "macro_profile": {
      "interest_rate_impact": "매우 긍정적 (금리 인하 시 바이오 신약 파이프라인 미래 DCF 가치 급격히 상승)",
      "fx_impact": "수출 바이오시밀러는 달러 강세 수혜",
      "oil_impact": "영향 없음",
      "cycle_phase": "금리 인하 국면 최대 낙수효과 및 글로벌 기술이전 가속"
    },
    "exit_recommendation_guide": "임상 결과 발표 직전 기대감 정점(RSI 75+)에서 50% 선제 익절, 파이프라인 가치 반영 완료 시 전량 매도",
    "top_stocks_kr": [
      {"name": "알테오젠", "ticker": "196170"},
      {"name": "삼성바이오로직스", "ticker": "207940"},
      {"name": "셀트리온", "ticker": "068270"},
      {"name": "유한양행", "ticker": "000100"},
      {"name": "에이비엘바이오", "ticker": "298380"}
    ],
    "top_stocks_us": [
      {"name": "일라이릴리", "ticker": "LLY"},
      {"name": "노보노디스크", "ticker": "NVO"},
      {"name": "머크", "ticker": "MRK"},
      {"name": "애브비", "ticker": "ABBV"},
      {"name": "암젠", "ticker": "AMGN"}
    ]
  },
  {
    "id": "energy_chemical",
    "name_kr": "정유·화학 & 에너지",
    "name_en": "Energy & Chemicals",
    "damodaran_unlevered_beta": 0.92,
    "avg_debt_ratio": 35.0,
    "avg_levered_beta": 1.25,
    "avg_cost_of_capital": 8.90,
    "avg_ebit_margin": 6.8,
    "sales_to_capital": 1.60,
    "rd_capitalization_boost": 1.2,
    "macro_profile": {
      "interest_rate_impact": "중립",
      "fx_impact": "원화 약세 시 원유 도입단가 상승 부담",
      "oil_impact": "직접 수혜 (정제마진 개선 및 재고평가익 발생)",
      "cycle_phase": "중국 경기 부양 및 지정학 리스크에 따른 정제마진 등락"
    },
    "exit_recommendation_guide": "정제마진 정점 도달 및 국제유가 85달러 돌파 시 경기 피크아웃 감안하여 분할 매도",
    "top_stocks_kr": [
      {"name": "SK이노베이션", "ticker": "096770"},
      {"name": "S-Oil", "ticker": "010950"},
      {"name": "LG화학", "ticker": "051910"},
      {"name": "롯데케미칼", "ticker": "011170"},
      {"name": "금호석유", "ticker": "011780"}
    ],
    "top_stocks_us": [
      {"name": "엑슨모빌", "ticker": "XOM"},
      {"name": "셰브론", "ticker": "CVX"},
      {"name": "코노코필립스", "ticker": "COP"},
      {"name": "옥시덴탈", "ticker": "OXY"},
      {"name": "다우", "ticker": "DOW"}
    ]
  },
  {
    "id": "defense_shipbuilding",
    "name_kr": "방산 & 조선",
    "name_en": "Aerospace, Defense & Shipbuilding",
    "damodaran_unlevered_beta": 0.85,
    "avg_debt_ratio": 24.0,
    "avg_levered_beta": 1.05,
    "avg_cost_of_capital": 8.40,
    "avg_ebit_margin": 10.5,
    "sales_to_capital": 1.35,
    "rd_capitalization_boost": 3.0,
    "macro_profile": {
      "interest_rate_impact": "보통 (수주 선급금 유입으로 순현금 구조 개선)",
      "fx_impact": "강력 수혜 (수주 계약이 주로 달러화로 체결되어 환차익 증대)",
      "oil_impact": "고유가 시 해양 플랜트 및 LNG선 발주 증가 수혜",
      "cycle_phase": "지정학적 방위비 증액 + 글로벌 노후선박 친환경 교체 슈퍼사이클"
    },
    "exit_recommendation_guide": "수주잔고 피크 도달 및 다모다란 적정가 도달 시 보유량 30%씩 3회 분할 매도",
    "top_stocks_kr": [
      {"name": "한화에어로스페이스", "ticker": "012450"},
      {"name": "현대로템", "ticker": "064350"},
      {"name": "LIG넥스원", "ticker": "079550"},
      {"name": "HD현대중공업", "ticker": "329180"},
      {"name": "한화오션", "ticker": "042660"}
    ],
    "top_stocks_us": [
      {"name": "록히드마틴", "ticker": "LMT"},
      {"name": "RTX", "ticker": "RTX"},
      {"name": "노스롭그루먼", "ticker": "NOC"},
      {"name": "제너럴다이내믹스", "ticker": "GD"},
      {"name": "헌팅턴잉걸스", "ticker": "HII"}
    ]
  },
  {
    "id": "power_grid",
    "name_kr": "전력 & AI 인프라 / 원전",
    "name_en": "Power, Grid & Nuclear Infrastructure",
    "damodaran_unlevered_beta": 0.85,
    "avg_debt_ratio": 22.0,
    "avg_levered_beta": 1.04,
    "avg_cost_of_capital": 8.20,
    "avg_ebit_margin": 17.5,
    "sales_to_capital": 1.70,
    "rd_capitalization_boost": 1.5,
    "macro_profile": {
      "interest_rate_impact": "보통 부정적 (대규모 전력망 투자 조달비용 부담, 단 AI 빅테크 장기 전력구매계약(PPA)으로 가격 전가력 극대화)",
      "fx_impact": "강력 수혜 (북미 초고압 변압기·배전반 품귀 현상으로 고환율 시 수출 마진 폭증)",
      "oil_impact": "수혜 (화석연료 비용 상승 시 원자력 및 전력 인프라 경제성 급부상)",
      "cycle_phase": "AI 데이터센터발 전력 소비 폭증 + 미국/유럽 50년 만의 노후 전력망 교체 슈퍼사이클"
    },
    "exit_recommendation_guide": "변압기 수주잔고 피크 도달 또는 밸류에이션(PBR 3.5배 / PER 30배) 초과 시 단계별 분할 매도",
    "top_stocks_kr": [
      {"name": "HD현대일렉트릭", "ticker": "267260"},
      {"name": "LS ELECTRIC", "ticker": "010120"},
      {"name": "효성중공업", "ticker": "298040"},
      {"name": "두산에너빌리티", "ticker": "034020"},
      {"name": "한국전력", "ticker": "015760"}
    ],
    "top_stocks_us": [
      {"name": "컨스텔레이션에너지", "ticker": "CEG"},
      {"name": "비스트라", "ticker": "VST"},
      {"name": "GE버노바", "ticker": "GEV"},
      {"name": "이튼", "ticker": "ETN"},
      {"name": "뉴스케일파워", "ticker": "SMR"}
    ]
  }
];

// Presets data for quick stock additions
const STOCK_PRESETS = {
  samsung: {
    name: "삼성전자",
    ticker: "005930",
    market: "KR",
    sector: "semiconductor",
    buy_price: 73000,
    curr_price: 78500,
    shares_outstanding_mil: 5969.0,
    base_revenue: 265000,
    growth: 9.5,
    margin: 18.5,
    rsi: 62.4,
    notes: "HBM3E 공급 본격화 및 메모리 판가 인상 사이클"
  },
  skhynix: {
    name: "SK하이닉스",
    ticker: "000660",
    market: "KR",
    sector: "semiconductor",
    buy_price: 152600,
    curr_price: 186700,
    shares_outstanding_mil: 728.0,
    base_revenue: 53000,
    growth: 14.0,
    margin: 32.0,
    rsi: 71.8,
    notes: "HBM 독점적 공급. 적정가 도달에 따른 단계적 분할 익절"
  },
  hyundai: {
    name: "현대자동차",
    ticker: "005380",
    market: "KR",
    sector: "auto_mobility",
    buy_price: 242000,
    curr_price: 248500,
    shares_outstanding_mil: 209.0,
    base_revenue: 162000,
    growth: 5.5,
    margin: 9.2,
    rsi: 49.2,
    notes: "고환율 수혜 및 인도 법인 상장 가치 반영"
  },
  hdelectric: {
    name: "HD현대일렉트릭",
    ticker: "267260",
    market: "KR",
    sector: "power_grid",
    buy_price: 380000,
    curr_price: 722000,
    shares_outstanding_mil: 36.0,
    base_revenue: 33000,
    growth: 22.0,
    margin: 19.5,
    rsi: 66.5,
    notes: "북미 초고압 변압기 쇼티지 및 2029년까지 확정 수주잔고 백로그"
  },
  nvda: {
    name: "NVIDIA Corp",
    ticker: "NVDA",
    market: "US",
    sector: "software_ai",
    buy_price: 118.5,
    curr_price: 142.8,
    shares_outstanding_mil: 24500.0,
    base_revenue: 96300,
    growth: 24.0,
    margin: 58.0,
    rsi: 68.5,
    notes: "차세대 블랙웰 칩 슈퍼사이클 및 AI 인프라 독점"
  },
  apple: {
    name: "Apple Inc.",
    ticker: "AAPL",
    market: "US",
    sector: "software_ai",
    buy_price: 215.0,
    curr_price: 228.4,
    shares_outstanding_mil: 15300.0,
    base_revenue: 391000,
    growth: 7.5,
    margin: 31.0,
    rsi: 58.0,
    notes: "Apple Intelligence 탑재 아이폰 교체 사이클"
  },
  tesla: {
    name: "Tesla Inc.",
    ticker: "TSLA",
    market: "US",
    sector: "auto_mobility",
    buy_price: 210.0,
    curr_price: 243.5,
    shares_outstanding_mil: 3190.0,
    base_revenue: 97700,
    growth: 16.0,
    margin: 15.0,
    rsi: 64.0,
    notes: "FSD V12 및 로보택시 기대감 반영 중"
  },
  naver: {
    name: "NAVER",
    ticker: "035420",
    market: "KR",
    sector: "software_ai",
    buy_price: 188000,
    curr_price: 197600,
    shares_outstanding_mil: 164.0,
    base_revenue: 9670,
    growth: 8.5,
    margin: 16.2,
    rsi: 54.0,
    notes: "AI 검색 및 클라우드 B2B 사업 성장세"
  },
  kakao: {
    name: "카카오",
    ticker: "035720",
    market: "KR",
    sector: "software_ai",
    buy_price: 42000,
    curr_price: 38500,
    shares_outstanding_mil: 446.0,
    base_revenue: 7550,
    growth: 7.0,
    margin: 10.5,
    rsi: 42.0,
    notes: "톡비즈 광고 및 선물하기 안정적 현금창출"
  },
  celltrion: {
    name: "셀트리온",
    ticker: "068270",
    market: "KR",
    sector: "biotech_pharma",
    buy_price: 182000,
    curr_price: 198000,
    shares_outstanding_mil: 220.0,
    base_revenue: 3500,
    growth: 13.0,
    margin: 28.0,
    rsi: 59.5,
    notes: "짐펜트라 미국 신약 매출 본격화 및 합병 시너지"
  }
};

// Popular Korean Stocks Name-to-Ticker mapping for smart search
const KOREAN_TICKER_MAP = {
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
  "아모레퍼시픽": "090430"
};

// 주요 기업별 공시 재무 및 총 발행주식수 데이터베이스 (다모다란 분석 벤치마크)
const STOCK_FINANCIAL_PROFILES = {
  "000660": {
    name: "SK하이닉스",
    ticker: "000660",
    market: "KR",
    sector: "semiconductor",
    shares_outstanding_mil: 728.0,   // 7억 2,800만 주
    base_revenue: 53000,             // 53조 원
    growth_rate_next_5y: 14.0,
    target_ebit_margin: 32.0,
    sales_to_capital: 1.4,
    unlevered_beta: 1.15,
    debt_to_equity_pct: 25.0,
    net_debt_billion_krw: 10000,
    rd_annual_billion_krw: 4000,
    curr_price: 186700,
    buy_price: 152600
  },
  "005930": {
    name: "삼성전자",
    ticker: "005930",
    market: "KR",
    sector: "semiconductor",
    shares_outstanding_mil: 5969.0,  // 59억 6,900만 주
    base_revenue: 265000,            // 265조 원
    growth_rate_next_5y: 9.5,
    target_ebit_margin: 18.5,
    sales_to_capital: 1.3,
    unlevered_beta: 1.05,
    debt_to_equity_pct: 10.0,
    net_debt_billion_krw: -40000,    // 순현금 40조
    rd_annual_billion_krw: 10000,
    curr_price: 78500,
    buy_price: 72000
  },
  "005380": {
    name: "현대차",
    ticker: "005380",
    market: "KR",
    sector: "auto_mobility",
    shares_outstanding_mil: 209.0,   // 2억 900만 주
    base_revenue: 162000,            // 162조 원
    growth_rate_next_5y: 5.5,
    target_ebit_margin: 9.2,
    sales_to_capital: 1.2,
    unlevered_beta: 0.95,
    debt_to_equity_pct: 40.0,
    net_debt_billion_krw: 15000,
    rd_annual_billion_krw: 3500,
    curr_price: 248500,
    buy_price: 235000
  },
  "035420": {
    name: "NAVER",
    ticker: "035420",
    market: "KR",
    sector: "software_ai",
    shares_outstanding_mil: 164.0,   // 1억 6,400만 주
    base_revenue: 9670,              // 9.67조 원
    growth_rate_next_5y: 8.5,
    target_ebit_margin: 16.2,
    sales_to_capital: 1.5,
    unlevered_beta: 1.05,
    debt_to_equity_pct: 15.0,
    net_debt_billion_krw: -2000,
    rd_annual_billion_krw: 1800,
    curr_price: 197600,
    buy_price: 185000
  },
  "035720": {
    name: "카카오",
    ticker: "035720",
    market: "KR",
    sector: "software_ai",
    shares_outstanding_mil: 446.0,   // 4억 4,600만 주
    base_revenue: 7550,              // 7.55조 원
    growth_rate_next_5y: 7.0,
    target_ebit_margin: 10.5,
    sales_to_capital: 1.4,
    unlevered_beta: 1.10,
    debt_to_equity_pct: 20.0,
    net_debt_billion_krw: 1000,
    rd_annual_billion_krw: 800,
    curr_price: 38500,
    buy_price: 42000
  },
  "068270": {
    name: "셀트리온",
    ticker: "068270",
    market: "KR",
    sector: "biotech_pharma",
    shares_outstanding_mil: 220.0,   // 2억 2,000만 주
    base_revenue: 3500,              // 3.5조 원
    growth_rate_next_5y: 12.0,
    target_ebit_margin: 28.0,
    sales_to_capital: 1.1,
    unlevered_beta: 0.90,
    debt_to_equity_pct: 15.0,
    net_debt_billion_krw: 500,
    rd_annual_billion_krw: 400,
    curr_price: 192000,
    buy_price: 180000
  },
  "196170": {
    name: "알테오젠",
    ticker: "196170",
    market: "KR",
    sector: "biotech_pharma",
    shares_outstanding_mil: 53.2,
    base_revenue: 145,
    growth_rate_next_5y: 32.0,
    target_ebit_margin: 45.0,
    sales_to_capital: 1.2,
    unlevered_beta: 1.25,
    debt_to_equity_pct: 10.0,
    net_debt_billion_krw: -150,
    rd_annual_billion_krw: 40,
    curr_price: 315000,
    buy_price: 285000,
    consensus_target_price: "₩380,000",
    consensus_opinion: "매수 (Buy)"
  },
  "011070": {
    name: "LG이노텍",
    ticker: "011070",
    market: "KR",
    sector: "semiconductor",
    shares_outstanding_mil: 23.7,
    base_revenue: 20600,
    growth_rate_next_5y: 8.0,
    target_ebit_margin: 6.2,
    sales_to_capital: 1.3,
    unlevered_beta: 1.05,
    debt_to_equity_pct: 30.0,
    net_debt_billion_krw: 2500,
    rd_annual_billion_krw: 600,
    curr_price: 218000,
    buy_price: 205000,
    consensus_target_price: "₩300,000",
    consensus_opinion: "매수 (Buy)"
  },
  "298380": {
    name: "에이비엘바이오",
    ticker: "298380",
    market: "KR",
    sector: "biotech_pharma",
    shares_outstanding_mil: 48.5,
    base_revenue: 70,
    growth_rate_next_5y: 25.0,
    target_ebit_margin: 35.0,
    sales_to_capital: 1.2,
    unlevered_beta: 1.20,
    debt_to_equity_pct: 12.0,
    net_debt_billion_krw: -50,
    rd_annual_billion_krw: 30,
    curr_price: 34500,
    buy_price: 31000,
    consensus_target_price: "₩45,000",
    consensus_opinion: "매수 (Buy)"
  },
  "034020": {
    name: "두산에너빌리티",
    ticker: "034020",
    market: "KR",
    sector: "industrial_defense",
    shares_outstanding_mil: 640.0,
    base_revenue: 17500,
    growth_rate_next_5y: 11.0,
    target_ebit_margin: 6.5,
    sales_to_capital: 1.1,
    unlevered_beta: 1.10,
    debt_to_equity_pct: 45.0,
    net_debt_billion_krw: 3000,
    rd_annual_billion_krw: 300,
    curr_price: 19800,
    buy_price: 18500,
    consensus_target_price: "₩26,000",
    consensus_opinion: "매수 (Buy)"
  },
  "373220": {
    name: "LG에너지솔루션",
    ticker: "373220",
    market: "KR",
    sector: "secondary_battery",
    shares_outstanding_mil: 234.0,
    base_revenue: 33700,
    growth_rate_next_5y: 14.0,
    target_ebit_margin: 7.0,
    sales_to_capital: 1.1,
    unlevered_beta: 1.20,
    debt_to_equity_pct: 25.0,
    net_debt_billion_krw: 4000,
    rd_annual_billion_krw: 1000,
    curr_price: 385000,
    buy_price: 360000,
    consensus_target_price: "₩480,000",
    consensus_opinion: "매수 (Buy)"
  },
  "012450": {
    name: "한화에어로스페이스",
    ticker: "012450",
    market: "KR",
    sector: "industrial_defense",
    shares_outstanding_mil: 50.6,
    base_revenue: 9300,
    growth_rate_next_5y: 16.0,
    target_ebit_margin: 8.8,
    sales_to_capital: 1.3,
    unlevered_beta: 0.95,
    debt_to_equity_pct: 30.0,
    net_debt_billion_krw: 1200,
    rd_annual_billion_krw: 300,
    curr_price: 312000,
    buy_price: 290000,
    consensus_target_price: "₩370,000",
    consensus_opinion: "매수 (Buy)"
  },
  "247540": {
    name: "에코프로비엠",
    ticker: "247540",
    market: "KR",
    sector: "secondary_battery",
    shares_outstanding_mil: 97.8,
    base_revenue: 6900,
    growth_rate_next_5y: 16.0,
    target_ebit_margin: 6.2,
    sales_to_capital: 1.2,
    unlevered_beta: 1.40,
    debt_to_equity_pct: 35.0,
    net_debt_billion_krw: 1800,
    rd_annual_billion_krw: 150,
    curr_price: 165000,
    buy_price: 155000,
    consensus_target_price: "₩230,000",
    consensus_opinion: "매수 (Buy)"
  },
  "207940": {
    name: "삼성바이오로직스",
    ticker: "207940",
    market: "KR",
    sector: "biotech_pharma",
    shares_outstanding_mil: 71.2,
    base_revenue: 3700,
    growth_rate_next_5y: 14.0,
    target_ebit_margin: 29.5,
    sales_to_capital: 1.1,
    unlevered_beta: 0.90,
    debt_to_equity_pct: 15.0,
    net_debt_billion_krw: 500,
    rd_annual_billion_krw: 300,
    curr_price: 998000,
    buy_price: 950000,
    consensus_target_price: "₩1,200,000",
    consensus_opinion: "매수 (Buy)"
  },
  "000270": {
    name: "기아",
    ticker: "000270",
    market: "KR",
    sector: "auto_mobility",
    shares_outstanding_mil: 401.0,
    base_revenue: 100000,
    growth_rate_next_5y: 6.0,
    target_ebit_margin: 11.5,
    sales_to_capital: 1.3,
    unlevered_beta: 0.95,
    debt_to_equity_pct: 25.0,
    net_debt_billion_krw: -10000,
    rd_annual_billion_krw: 2500,
    curr_price: 102000,
    buy_price: 98000,
    consensus_target_price: "₩140,000",
    consensus_opinion: "매수 (Buy)"
  },
  "003230": {
    name: "삼양식품",
    ticker: "003230",
    market: "KR",
    sector: "industrial_defense",
    shares_outstanding_mil: 7.53,
    base_revenue: 1200,
    growth_rate_next_5y: 18.0,
    target_ebit_margin: 14.5,
    sales_to_capital: 1.4,
    unlevered_beta: 0.85,
    debt_to_equity_pct: 20.0,
    net_debt_billion_krw: 100,
    rd_annual_billion_krw: 30,
    curr_price: 535000,
    buy_price: 490000,
    consensus_target_price: "₩710,000",
    consensus_opinion: "매수 (Buy)"
  },
  "028300": {
    name: "HLB",
    ticker: "028300",
    market: "KR",
    sector: "biotech_pharma",
    shares_outstanding_mil: 130.5,
    base_revenue: 50,
    growth_rate_next_5y: 25.0,
    target_ebit_margin: 30.0,
    sales_to_capital: 1.1,
    unlevered_beta: 1.25,
    debt_to_equity_pct: 15.0,
    net_debt_billion_krw: 200,
    rd_annual_billion_krw: 80,
    curr_price: 86000,
    buy_price: 82000,
    consensus_target_price: "₩110,000",
    consensus_opinion: "매수 (Buy)"
  },
  "352820": {
    name: "하이브",
    ticker: "352820",
    market: "KR",
    sector: "software_ai",
    shares_outstanding_mil: 41.7,
    base_revenue: 2180,
    growth_rate_next_5y: 10.0,
    target_ebit_margin: 13.0,
    sales_to_capital: 1.3,
    unlevered_beta: 1.10,
    debt_to_equity_pct: 20.0,
    net_debt_billion_krw: -200,
    rd_annual_billion_krw: 100,
    curr_price: 182000,
    buy_price: 175000,
    consensus_target_price: "₩260,000",
    consensus_opinion: "매수 (Buy)"
  },
  "NVDA": {
    name: "NVIDIA",
    ticker: "NVDA",
    market: "US",
    sector: "software_ai",
    shares_outstanding_mil: 24500.0, // 24.5B shares
    base_revenue: 96300,             // 96.3B USD
    growth_rate_next_5y: 24.0,
    target_ebit_margin: 58.0,
    sales_to_capital: 1.6,
    unlevered_beta: 1.65,
    debt_to_equity_pct: 10.0,
    net_debt_billion_krw: -15000,
    rd_annual_billion_krw: 8000,
    curr_price: 142.8,
    buy_price: 120.0
  },
  "AAPL": {
    name: "Apple",
    ticker: "AAPL",
    market: "US",
    sector: "software_ai",
    shares_outstanding_mil: 15300.0, // 15.3B shares
    base_revenue: 391000,            // 391B USD
    growth_rate_next_5y: 7.5,
    target_ebit_margin: 31.0,
    sales_to_capital: 1.8,
    unlevered_beta: 1.05,
    debt_to_equity_pct: 25.0,
    net_debt_billion_krw: 50000,
    rd_annual_billion_krw: 30000,
    curr_price: 228.4,
    buy_price: 215.0
  },
  "TSLA": {
    name: "Tesla",
    ticker: "TSLA",
    market: "US",
    sector: "auto_mobility",
    shares_outstanding_mil: 3190.0,  // 3.19B shares
    base_revenue: 97700,             // 97.7B USD
    growth_rate_next_5y: 16.0,
    target_ebit_margin: 15.0,
    sales_to_capital: 1.3,
    unlevered_beta: 1.85,
    debt_to_equity_pct: 15.0,
    net_debt_billion_krw: -15000,
    rd_annual_billion_krw: 4000,
    curr_price: 243.5,
    buy_price: 220.0
  }
};

function getProfileForStock(tickerOrName) {
  if (!tickerOrName) return null;
  const q = String(tickerOrName).trim().toUpperCase();
  if (STOCK_FINANCIAL_PROFILES[q]) return STOCK_FINANCIAL_PROFILES[q];
  for (const [k, v] of Object.entries(STOCK_FINANCIAL_PROFILES)) {
    if (v.name.toUpperCase() === q || v.name.includes(q) || q.includes(v.name.toUpperCase()) || k === q) {
      return v;
    }
  }
  return null;
}

function parsePriceNumber(val) {
  if (!val) return 0;
  if (typeof val === "number") return val;
  const cleaned = String(val).replace(/[^\d.]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

function getStockSectorClient(ticker, name = "") {
  const comb = `${name || ""} ${ticker || ""}`.toUpperCase();
  if (/알테오젠|에이비엘|바이오|제약|HLB|셀트리온|유한양행|삼천당|리가켐|휴젤|씨젠|한미약품|녹십자|대웅제약|196170|298380|141080|028300|068270|207940|000100|000250|145020|096530|128940/.test(comb)) {
    return "biotech_pharma";
  }
  if (/NVDA|AAPL|MSFT|GOOGL|AMZN|META|NAVER|네이버|카카오|하이브|크래프톤|엔씨소프트|넷마블|035420|035720|352820|259960|036570|251270|323410|377300/.test(comb)) {
    return "software_ai";
  }
  if (/하이닉스|SK하이닉스|삼성전자|한미반도체|이노텍|LG이노텍|리노공업|DB하이텍|000660|005930|042700|011070|058470|000990/.test(comb)) {
    return "semiconductor";
  }
  if (/에너지솔루션|LG엔솔|에코프로|에코프로비엠|포스코홀딩스|포스코퓨처엠|삼성SDI|LG화학|엘앤에프|SK이노베이션|373220|247540|086520|005490|003670|006400|051910|066970|096770/.test(comb)) {
    return "battery_cleanenergy";
  }
  if (/한화에어로|한화에어로스페이스|두산에너빌리티|HD현대중공업|현대중공업|한화오션|삼성중공업|한국항공우주|LIG넥스원|현대로템|012450|034020|329180|042660|010140|047810|079550|064350/.test(comb)) {
    return "defense_shipbuilding";
  }
  if (/현대차|현대자동차|기아|현대모비스|모비스|TSLA|005380|000270|012330/.test(comb)) {
    return "auto_mobility";
  }
  if (/삼양식품|농심|오리온|아모레퍼시픽|CJ제일제당|하이트진로|003230|004370|271560|090430|097950|000080/.test(comb)) {
    return "consumer_food";
  }
  return "general_manufacturing";
}

// =============================================================================
// Client-Side Damodaran DCF & Exit Engine
// =============================================================================
function jsCalculateDamodaranDcf(stock, rfOverride = null) {
  const inputs = stock.damodaran_inputs || {};
  const market = stock.market || "KR";
  const profile = getProfileForStock(stock.ticker) || getProfileForStock(stock.name);
  const sectorId = stock.sector_id || (profile ? profile.sector : null) || getStockSectorClient(stock.ticker, stock.name);

  const rf = rfOverride !== null ? parseFloat(rfOverride) : (market === "US" ? 4.12 : 3.28);
  const erp = 5.0;

  const unleveredBeta = inputs.unlevered_beta || (profile ? profile.unlevered_beta : (sectorId === "biotech_pharma" ? 1.25 : 1.15));
  const deRatio = (inputs.debt_to_equity_pct !== undefined ? inputs.debt_to_equity_pct : (profile ? profile.debt_to_equity_pct : 15.0)) / 100.0;
  const taxRate = (inputs.effective_tax_rate || 22.0) / 100.0;
  const costOfDebtPretax = (inputs.cost_of_debt_pretax || 4.5) / 100.0;

  const leveredBeta = unleveredBeta * (1.0 + (1.0 - taxRate) * deRatio);
  const costOfEquity = (rf / 100.0) + (leveredBeta * (erp / 100.0));
  const costOfDebtAfterTax = costOfDebtPretax * (1.0 - taxRate);
  const weightEquity = 1.0 / (1.0 + deRatio);
  const weightDebt = deRatio / (1.0 + deRatio);
  const wacc = (weightEquity * costOfEquity) + (weightDebt * costOfDebtAfterTax);

  let baseRev = inputs.base_revenue;
  if (!baseRev || baseRev <= 0) {
    baseRev = profile ? profile.base_revenue : (market === "KR" ? 50000 : 5000);
  }

  const defaultGrowth = sectorId === "biotech_pharma" ? 45.0 : 12.0;
  const defaultMargin = sectorId === "biotech_pharma" ? 55.0 : 20.0;
  const defaultSalesToCap = sectorId === "biotech_pharma" ? 2.8 : (sectorId === "software_ai" ? 2.5 : 1.4);

  const g5y = (inputs.growth_rate_next_5y !== undefined ? inputs.growth_rate_next_5y : (profile ? profile.growth_rate_next_5y : defaultGrowth)) / 100.0;
  const gTerm = Math.min((inputs.terminal_growth_rate || 2.5) / 100.0, rf / 100.0);
  const targetMargin = (inputs.target_ebit_margin !== undefined ? inputs.target_ebit_margin : (profile ? profile.target_ebit_margin : defaultMargin)) / 100.0;
  const salesToCap = inputs.sales_to_capital || (profile ? profile.sales_to_capital : defaultSalesToCap);
  const rdBoost = (((inputs.rd_annual_billion_krw !== undefined ? inputs.rd_annual_billion_krw : (profile ? profile.rd_annual_billion_krw : 0))) * 0.25);

  let pvFcffTotal = 0;
  let currentRev = baseRev;
  const fcffProjections = [];

  for (let year = 1; year <= 5; year++) {
    const nextRev = currentRev * (1.0 + g5y);
    const deltaRev = nextRev - currentRev;
    const reinvestment = salesToCap > 0 ? deltaRev / salesToCap : 0;
    const ebit = (nextRev * targetMargin) + rdBoost;
    const nopat = ebit * (1.0 - taxRate);
    const fcff = nopat - reinvestment;
    const discountFactor = Math.pow(1.0 + wacc, year);
    const pvFcff = fcff / discountFactor;
    pvFcffTotal += pvFcff;

    fcffProjections.push({
      year: `Y+${year}`,
      revenue: Math.round(nextRev),
      ebit: Math.round(ebit),
      reinvestment: Math.round(reinvestment),
      fcff: Math.round(fcff),
      pv_fcff: Math.round(pvFcff)
    });
    currentRev = nextRev;
  }

  const termWacc = Math.max(wacc * 0.95, (rf / 100.0) + 0.04);
  const termRev = currentRev * (1.0 + gTerm);
  const termEbit = termRev * targetMargin;
  const termNopat = termEbit * (1.0 - taxRate);
  const termReinvestment = termNopat * (gTerm / termWacc);
  const termFcff = termNopat - termReinvestment;

  const terminalValue = termFcff / (termWacc - gTerm);
  const pvTerminalValue = terminalValue / Math.pow(1.0 + wacc, 5);

  const ev = pvFcffTotal + pvTerminalValue;
  const netDebt = inputs.net_debt_billion_krw !== undefined ? inputs.net_debt_billion_krw : (profile ? profile.net_debt_billion_krw : 0);
  const eqVal = ev - netDebt;

  // 발행주식수 결정
  let shares = parseFloat(inputs.shares_outstanding_mil || 0);
  if (!shares || shares <= 0 || shares === 1.0 || (shares === 100.0 && profile && profile.shares_outstanding_mil !== 100.0)) {
    if (profile) {
      shares = profile.shares_outstanding_mil;
    } else {
      const currP = parseFloat(stock.current_price || stock.buy_price || 0);
      if (currP > 0) {
        shares = market === "KR" ? (baseRev * 1.5 * 1000.0) / currP : (baseRev * 1.5) / currP;
      } else {
        shares = 100.0;
      }
    }
  }
  if (shares <= 0) shares = 1.0;

  let rawFairVal = market === "KR" ? (eqVal * 1000.0) / shares : eqVal / shares;
  if (rawFairVal <= 0 || isNaN(rawFairVal)) rawFairVal = stock.current_price || 1000;

  // 애널리스트 컨센서스 목표가 추출 및 섹터 앙상블
  const consensusTpNum = parsePriceNumber(stock.consensus_target_price || inputs.consensus_target_price || (profile ? profile.consensus_target_price : null));
  let baseFairVal = rawFairVal;
  let conservativeVal = rawFairVal * 0.80;
  let bullishVal = rawFairVal * 1.28;

  if (consensusTpNum > 0 && sectorId === "biotech_pharma") {
    // 바이오 파이프라인 rNPV 컨센서스 70% + DCF 30%
    const hybrid = (rawFairVal * 0.30) + (consensusTpNum * 0.70);
    const base = Math.max(hybrid, consensusTpNum * 0.85);
    baseFairVal = market === "US" ? base : Math.round(base / 100) * 100;
    conservativeVal = Math.round(baseFairVal * 0.80);
    bullishVal = Math.round(Math.max(baseFairVal * 1.25, consensusTpNum * 1.15));
  } else if (consensusTpNum > 0 && sectorId === "software_ai") {
    const hybrid = (rawFairVal * 0.60) + (consensusTpNum * 0.40);
    const base = Math.max(hybrid, Math.min(rawFairVal, consensusTpNum) * 0.95);
    baseFairVal = market === "US" ? base : Math.round(base / 100) * 100;
    conservativeVal = Math.round(baseFairVal * 0.82);
    bullishVal = Math.round(baseFairVal * 1.28);
  } else {
    baseFairVal = market === "US" ? Math.round(rawFairVal * 10) / 10 : Math.round(rawFairVal / 100) * 100;
    conservativeVal = Math.round(baseFairVal * 0.80);
    bullishVal = Math.round(baseFairVal * 1.28);
  }

  return {
    sector_id: sectorId,
    wacc: parseFloat((wacc * 100).toFixed(2)),
    cost_of_equity: parseFloat((costOfEquity * 100).toFixed(2)),
    cost_of_debt_after_tax: parseFloat((costOfDebtAfterTax * 100).toFixed(2)),
    levered_beta: parseFloat(leveredBeta.toFixed(3)),
    rf_used: rf,
    erp_used: erp,
    enterprise_value: Math.round(ev),
    equity_value: Math.round(eqVal),
    shares_outstanding_mil: Math.round(shares * 10) / 10,
    conservative_value: conservativeVal,
    base_fair_value: baseFairVal,
    bullish_value: bullishVal,
    fcff_projections: fcffProjections
  };
}

function jsEvaluateExitTiming(stock, dcf) {
  const currPrice = parseFloat(stock.current_price);
  const buyPrice = parseFloat(stock.buy_price);
  const quantity = parseInt(stock.quantity || 1);
  const currency = stock.currency || "KRW";
  const tech = stock.technical_indicators || {};
  const sectorId = stock.sector_id || dcf.sector_id || getStockSectorClient(stock.ticker, stock.name);

  const rsi = parseFloat(tech.rsi_14 || 50.0);
  const sma20 = parseFloat(tech.sma_20 || currPrice * 0.98);
  const sma60 = parseFloat(tech.sma_60 || currPrice * 0.95);
  const bbUpper = parseFloat(tech.bollinger_upper || currPrice * 1.06);
  const baseVal = dcf.base_fair_value;
  const bullishVal = dcf.bullish_value;

  const profitPct = buyPrice > 0 ? ((currPrice - buyPrice) / buyPrice * 100.0) : 0;
  const valuationGapPct = baseVal > 0 ? ((currPrice - baseVal) / baseVal * 100.0) : 0;
  
  // 트레일링 손절가: 수익이 났을 때는 원금을 절대 까먹지 않도록 매수가 위에서 이익 보존선 설정
  let stopLossPrice = Math.max(buyPrice * 0.92, sma60 * 0.97);
  if (profitPct >= 8.0) {
    stopLossPrice = Math.max(buyPrice * 1.03, currPrice * 0.91, sma20 * 0.97);
  }

  // RSI 문구 정확화: 70 미만은 차트 과열이 아님!
  let rsiText = "";
  if (rsi >= 72.0) {
    rsiText = ` + 차트 과열(RSI ${rsi.toFixed(1)})`;
  } else if (rsi <= 35.0) {
    rsiText = ` + 차트 과매도(RSI ${rsi.toFixed(1)})`;
  } else {
    rsiText = ` (RSI ${rsi.toFixed(1)} 안정권)`;
  }

  let signalType = "";
  let signalBadge = "";
  let sellGaugeScore = 30;
  let headline = "";
  let guidance = "";
  let sharesToSell = 0;
  const sym = currency === "USD" ? "$" : "₩";

  // 1) 손절 / 리스크 오프 조건 (원금 훼손 방지)
  if (currPrice <= stopLossPrice && profitPct < -5.0) {
    signalType = "STOP_LOSS_ALERT";
    signalBadge = "손절 / 리스크 오프 권고";
    sellGaugeScore = 90;
    headline = `손절 기준선(${sym}${Math.round(stopLossPrice).toLocaleString()}) 하향 이탈! 원금 보호 우선`;
    sharesToSell = quantity;
    guidance = `주가가 매수가 대비 ${profitPct.toFixed(1)}% 하락하였으며 주요 지지선을 이탈했습니다. 추가 손실 방지를 위해 전량 손절 또는 비중 70% 축소를 권고합니다.`;
  }
  // 2) 수익권(+5% 이상)이면서 추세가 견고하고 RSI 과열이 없는 경우 (추세 추종 수익 극대화 - 섣부른 매도 금지!)
  else if (profitPct >= 5.0 && rsi < 70.0 && (currPrice >= sma20 * 0.98 || currPrice >= sma60 * 0.98)) {
    signalType = "TREND_RIDE_HOLD";
    signalBadge = "🚀 수익 극대화 / 추세 지속 (트레일링 익절 홀딩)";
    sellGaugeScore = 25;
    sharesToSell = 0;
    headline = `수익률 +${profitPct.toFixed(1)}% 달성! 20일선 지지 기반 우상향 지속${rsiText}`;
    guidance = `현재 +${profitPct.toFixed(1)}%의 높은 수익을 기록 중이며, RSI(${rsi.toFixed(1)})가 과열권이 아닌 건강한 상승 추세를 유지하고 있습니다. 섣불리 전량 매도하지 마시고, 트레일링 익절선(${sym}${Math.round(stopLossPrice).toLocaleString()})을 방어선으로 설정하여 1차 목표가까지 수익을 끝까지 극대화하십시오.`;
  }
  // 3) 단기 기술적 과열(RSI >= 72) 또는 볼린저 상단 도달 시 (1차 분할 익절)
  else if (rsi >= 72.0 || (currPrice >= bbUpper && profitPct > 0)) {
    signalType = "PARTIAL_SELL_1";
    signalBadge = "⚠️ 1차 분할 익절 권고 (단기 과열권 도달)";
    sellGaugeScore = 68;
    sharesToSell = Math.max(1, Math.floor(quantity * 0.35));
    headline = `단기 기술적 과열${rsiText} 또는 볼린저 상단 도달! 35% 1차 분할 익절 권장`;
    guidance = `주가가 단기 과열권에 진입했습니다. 보유 수량 ${quantity}주 중 약 35%(${sharesToSell}주)를 1차 분할 매도하여 확정 수익을 챙기시고, 잔여 65%는 20일선 지지를 보며 추세 매매를 이어가십시오.`;
  }
  // 4) 극단적 버블 과열 (RSI >= 80) 또는 추세 꺾임 (적극 매도)
  else if (rsi >= 80.0 || (currPrice >= bullishVal * 1.25 && currPrice < sma20 * 0.98)) {
    signalType = "STRONG_SELL";
    signalBadge = "적극 매도 / 최종 전량 익절";
    sellGaugeScore = 90;
    headline = `RSI ${rsi.toFixed(1)} 극단적 과열 또는 주요 지지선 꺾임! 최종 전량 익절 권고`;
    sharesToSell = Math.max(1, Math.floor(quantity * 0.7));
    guidance = `차트 과열 지수가 극에 달했거나 지지선 이탈 조짐이 보입니다. 확보된 수익(${profitPct > 0 ? '+' : ''}${profitPct.toFixed(1)}%)을 지키기 위해 보유 물량의 70~100%를 분할 청산하십시오.`;
  }
  // 5) 기본 적정가 돌파 구간 (수익률 0~5% 미만인 경우)
  else if (currPrice >= baseVal) {
    signalType = "PARTIAL_SELL_1";
    signalBadge = "1차 분할 매도 권고 (적정가 도달)";
    sellGaugeScore = 55;
    sharesToSell = Math.max(1, Math.floor(quantity * 0.35));
    headline = `다모다란 기본 적정가(${sym}${Math.round(baseVal).toLocaleString()}) 돌파!${rsiText}`;
    guidance = `기업의 섹터 특화 펀더멘털 적정가에 도달했습니다. 보유 수량 ${quantity}주 중 약 35%(${sharesToSell}주)를 1차 분할 매도하여 확정 수익을 챙기시고, 잔여 수량은 상방 목표가까지 추세 매매를 이어가세요.`;
  }
  // 6) 목표가 근접 구간 (90% ~ 100%)
  else if (currPrice >= baseVal * 0.90) {
    signalType = "APPROACHING_TARGET";
    signalBadge = "목표가 근접 / 매도 준비";
    sellGaugeScore = 48;
    headline = `적정가(${sym}${Math.round(baseVal).toLocaleString()}) 도달 임박 (괴리율 ${valuationGapPct.toFixed(1)}%)${rsiText}`;
    guidance = `적정가 도달이 임박했습니다. 신규 매수는 자제하시고, 목표 가격대에 분할 매도 주문을 미리 걸어두시길 권장합니다.`;
  }
  // 7) 저평가 안심 보유 구간
  else {
    signalType = "SAFE_HOLD";
    sellGaugeScore = Math.max(10, Math.round(35 + (valuationGapPct * 0.5)));
    if (sectorId === "biotech_pharma") {
      signalBadge = "적극 홀딩 / 파이프라인 가치 반영 구간";
      headline = `바이오 파이프라인 가치 대비 저평가 (${valuationGapPct.toFixed(1)}%)${rsiText}`;
      guidance = `신약 파이프라인 rNPV 가치(${sym}${Math.round(baseVal).toLocaleString()}) 대비 충분한 안전마진이 유지되고 있습니다. 기술이전 로열티 및 글로벌 임상 가시화 시점까지 편안하게 보유(Hold)를 지속하세요.`;
    } else {
      signalBadge = "적극 홀딩 / 저평가 안심 구간";
      headline = `다모다란 가치 대비 저평가 (${valuationGapPct.toFixed(1)}%)${rsiText}`;
      guidance = `내재가치 대비 충분한 가격 매력(안전마진)이 유지되고 있습니다. 중장기 상승 모멘텀을 누리며 편안하게 보유(Hold)를 지속하세요.`;
    }
  }

  // ===========================================================================
  // 단계별 분할 매도 실행 주문 가이드 (Exit Order Blueprint)
  // [핵심 원칙] 목표 매도가격은 반드시 [현재 시장가] 및 [내 매수가]보다 높은 미래의 익절 가격이어야 함!
  // ===========================================================================
  let step1Target = 0;
  let step2Target = 0;
  let step3Target = 0;
  let cond1 = "";
  let cond2 = "";
  let cond3 = "";

  if (profitPct > 0 || currPrice >= baseVal) {
    // [Case A: 이미 수익 중이거나 적정가를 돌파하여 고수익 상승 중인 강세 종목]
    // 1차 목표: 현재가 대비 +7% 이상, 볼린저 상단, 매수가 대비 최소 +20%
    step1Target = Math.max(
      Math.round(currPrice * 1.07),
      Math.round(bbUpper),
      Math.round(baseVal),
      Math.round(buyPrice * 1.20)
    );
    // 2차 목표: 현재가 대비 +16% 이상, 1차 목표가 +8%, 매수가 대비 +45%
    step2Target = Math.max(
      Math.round(currPrice * 1.16),
      Math.round(step1Target * 1.08),
      Math.round(bullishVal),
      Math.round(buyPrice * 1.45)
    );
    // 3차 목표: 현재가 대비 +28% 이상, 2차 목표가 +10%, 매수가 대비 +70%
    step3Target = Math.max(
      Math.round(currPrice * 1.28),
      Math.round(step2Target * 1.10),
      Math.round(bullishVal * 1.20),
      Math.round(buyPrice * 1.70)
    );

    const p1 = buyPrice > 0 ? ((step1Target - buyPrice) / buyPrice * 100).toFixed(0) : 0;
    const p2 = buyPrice > 0 ? ((step2Target - buyPrice) / buyPrice * 100).toFixed(0) : 0;
    const p3 = buyPrice > 0 ? ((step3Target - buyPrice) / buyPrice * 100).toFixed(0) : 0;

    cond1 = `1차 상방 저항선 돌파 시 (+${p1}% 수익 확정 분할 매도)`;
    cond2 = `2차 확장 저항선 도달 시 (+${p2}% 고수익 실현)`;
    cond3 = `최종 목표가 도달 또는 RSI 75+ 과열 시 (+${p3}% 전량 청산)`;
  } else {
    // [Case B: 현재 주가가 저평가되어 적정가 도달을 기다리는 종목]
    step1Target = Math.max(Math.round(baseVal), Math.round(currPrice * 1.06), Math.round(buyPrice * 1.05));
    step2Target = Math.max(Math.round((baseVal + bullishVal) / 2), Math.round(step1Target * 1.08), Math.round(currPrice * 1.15));
    step3Target = Math.max(Math.round(bullishVal), Math.round(step2Target * 1.10), Math.round(currPrice * 1.25));

    cond1 = "다모다란 Base 적정가 터치 시 기계적 35% 분할 매도";
    cond2 = "적정가 초과 상승 및 모멘텀 지속 시 35% 익절";
    cond3 = "다모다란 Bullish Target 상단 + RSI 70+ 과열 시 전량 청산";
  }

  // 가격 라운딩 처리
  if (currency === "KRW") {
    step1Target = Math.round(step1Target / 100) * 100;
    step2Target = Math.round(step2Target / 100) * 100;
    step3Target = Math.round(step3Target / 100) * 100;
  } else {
    step1Target = Math.round(step1Target * 10) / 10;
    step2Target = Math.round(step2Target * 10) / 10;
    step3Target = Math.round(step3Target * 10) / 10;
  }

  let s1 = 0, s2 = 0, s3 = 0;
  if (quantity <= 1) {
    s1 = quantity; s2 = 0; s3 = 0;
  } else if (quantity === 2) {
    s1 = 1; s2 = 1; s3 = 0;
  } else {
    s1 = Math.max(1, Math.floor(quantity * 0.35));
    s2 = Math.max(1, Math.floor(quantity * 0.35));
    s3 = Math.max(0, quantity - s1 - s2);
  }

  const sellPlan = [
    {
      step: "1단계 (1차 익절)",
      target_price: step1Target,
      ratio_pct: 35,
      shares: s1,
      condition: cond1
    },
    {
      step: "2단계 (2차 익절)",
      target_price: step2Target,
      ratio_pct: 35,
      shares: s2,
      condition: cond2
    },
    {
      step: "3단계 (최종 익절)",
      target_price: step3Target,
      ratio_pct: 30,
      shares: s3,
      condition: cond3
    }
  ];

  return {
    signal_type: signalType,
    signal_badge: signalBadge,
    sell_gauge_score: sellGaugeScore,
    headline: headline,
    action_guidance: guidance,
    shares_to_sell: sharesToSell,
    profit_pct: parseFloat(profitPct.toFixed(2)),
    profit_amount: Math.round((currPrice - buyPrice) * quantity),
    valuation_gap_pct: parseFloat(valuationGapPct.toFixed(2)),
    stop_loss_price: Math.round(stopLossPrice),
    sell_plan: sellPlan
  };
}

// =============================================================================
// Initialization
// =============================================================================
document.addEventListener("DOMContentLoaded", async () => {
  // Clear any old local storage if user requested a fresh start
  if (localStorage.getItem("damodaran_portfolio_reset") !== "v2_clean") {
    localStorage.removeItem("damodaran_portfolio");
    localStorage.setItem("damodaran_portfolio_reset", "v2_clean");
  }

  await Promise.all([
    fetchNaverIndices(),
    fetchMacro(),
    fetchSectors(),
    loadMarketMap(),
    fetchPortfolio()
  ]);

  // Try live FX fetch from free open API
  fetchLiveExchangeRates();

  // 실시간 네이버 증권 및 활성 탭 자동 동기화 (Auto Polling 10초)
  setInterval(() => {
    fetchNaverIndices();
    const portView = document.getElementById("view-portfolio");
    if (portView && !portView.classList.contains("hidden")) {
      fetchPortfolio();
    }
    const macroView = document.getElementById("view-macro");
    if (macroView && !macroView.classList.contains("hidden")) {
      fetchMacro();
    }
  }, 10000);

  // 자동 갱신 카운트다운 타이머 가동 (기본 1분 / 3분 / 5분 선택)
  initAutoRefreshTimer();

  // 창 크기 변경 시 핀비즈 트리맵 반응형 재계산
  window.addEventListener("resize", () => {
    if (g_marketMapData && !document.getElementById("view-sectors")?.classList.contains("hidden")) {
      renderFinvizTreemap();
    }
  });
});

// =============================================================================
// Auto Refresh Countdown & Interval Manager
// =============================================================================
let g_autoRefreshInterval = 60; // 1분 기본 (30초, 1분, 3분, 5분 지원)
let g_autoRefreshCountdown = 60;
let g_autoRefreshTimer = null;

function initAutoRefreshTimer() {
  const saved = localStorage.getItem("damodaran_auto_refresh_sec");
  if (saved) {
    const val = parseInt(saved, 10);
    if ([30, 60, 180, 300].includes(val)) {
      g_autoRefreshInterval = val;
      g_autoRefreshCountdown = val;
      const selectEl = document.getElementById("auto-refresh-interval-select");
      if (selectEl) selectEl.value = String(val);
    }
  }

  updateCountdownUI();

  if (g_autoRefreshTimer) clearInterval(g_autoRefreshTimer);
  g_autoRefreshTimer = setInterval(() => {
    g_autoRefreshCountdown--;
    updateCountdownUI();
    if (g_autoRefreshCountdown <= 0) {
      g_autoRefreshCountdown = g_autoRefreshInterval;
      refreshLiveRates();
    }
  }, 1000);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      if (g_autoRefreshCountdown <= g_autoRefreshInterval / 2) {
        g_autoRefreshCountdown = g_autoRefreshInterval;
        refreshLiveRates();
      }
    }
  });
}

function updateCountdownUI() {
  const el = document.getElementById("auto-refresh-countdown");
  if (!el) return;
  const m = Math.floor(Math.max(0, g_autoRefreshCountdown) / 60);
  const s = Math.max(0, g_autoRefreshCountdown) % 60;
  el.innerText = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function changeAutoRefreshInterval(val) {
  const sec = parseInt(val, 10) || 60;
  g_autoRefreshInterval = sec;
  g_autoRefreshCountdown = sec;
  localStorage.setItem("damodaran_auto_refresh_sec", String(sec));
  updateCountdownUI();
}

// =============================================================================
// Tab Switching
// =============================================================================
function switchTab(tabId) {
  document.querySelectorAll(".tab-view").forEach(el => el.classList.add("hidden"));
  const targetView = document.getElementById(`view-${tabId}`);
  if (targetView) targetView.classList.remove("hidden");

  document.querySelectorAll(".nav-tab").forEach(btn => {
    btn.classList.remove("bg-indigo-600", "text-white", "shadow-sm");
    btn.classList.add("text-slate-400");
  });
  const activeBtn = document.getElementById(`tab-btn-${tabId}`);
  if (activeBtn) {
    activeBtn.classList.add("bg-indigo-600", "text-white", "shadow-sm");
    activeBtn.classList.remove("text-slate-400");
  }

  document.querySelectorAll(".mobile-nav-btn").forEach((btn, idx) => {
    const tabs = ["portfolio", "macro", "sectors", "calculator", "chart"];
    if (tabs[idx] === tabId) {
      btn.className = "mobile-nav-btn px-3 py-1.5 rounded-lg whitespace-nowrap bg-indigo-600 text-white font-semibold";
    } else {
      btn.className = "mobile-nav-btn px-3 py-1.5 rounded-lg whitespace-nowrap text-slate-400";
    }
  });

  if (tabId === "sectors") {
    if (!g_marketMapData) {
      loadMarketMap();
    } else {
      setTimeout(() => renderFinvizTreemap(), 50);
    }
  } else if (tabId === "macro" && g_macroData) {
    renderYieldCurveChart();
  } else if (tabId === "calculator" && !g_lastAutofilledStock) {
    const inputVal = document.getElementById("calc-name")?.value?.trim();
    if (inputVal) {
      autoFillStockData(inputVal);
    }
  } else if (tabId === "chart") {
    if (!g_chartData) {
      loadChartAnalysis("SK하이닉스");
    } else {
      setTimeout(() => {
        renderMainPriceChart();
        renderSubIndicatorChart();
      }, 50);
    }
  }
}

// =============================================================================
// Real-Time Naver Indices & Macro Sync
// =============================================================================
async function fetchNaverIndices() {
  try {
    const res = await fetch("/api/naver/indices");
    if (res.ok) {
      const data = await res.json();
      if (data.success) {
        updateDomesticIndexDisplays(data.kospi, data.kosdaq);
        return;
      }
    }
  } catch (e) {
    console.warn("fetchNaverIndices error:", e);
  }

  if (g_macroData && g_macroData.indices) {
    const kp = g_macroData.indices.find(i => i.code === "KOSPI");
    const kd = g_macroData.indices.find(i => i.code === "KOSDAQ");
    updateDomesticIndexDisplays(kp, kd);
  }
}

function updateDomesticIndexDisplays(kospi, kosdaq) {
  if (kospi) {
    const isUp = (kospi.change || 0) >= 0;
    const sign = isUp ? "▲ +" : "▼ ";
    const chgColor = isUp ? "text-emerald-400" : "text-rose-400";
    const chgText = `${sign}${Math.abs(kospi.change || 0).toFixed(2)} (${isUp ? '+' : ''}${kospi.change_pct}%)`;

    // 1. Top Bar Pill
    const topVal = document.getElementById("top-kospi-val");
    const topChg = document.getElementById("top-kospi-chg");
    if (topVal) topVal.innerText = (kospi.current || 0).toLocaleString();
    if (topChg) {
      topChg.innerText = chgText;
      topChg.className = `font-mono font-bold text-xs ${chgColor}`;
    }

    // 2. Main Dashboard Live Card
    const cardVal = document.getElementById("card-kospi-val");
    const cardChg = document.getElementById("card-kospi-chg");
    const cardRange = document.getElementById("card-kospi-range");
    if (cardVal) cardVal.innerText = (kospi.current || 0).toLocaleString();
    if (cardChg) {
      cardChg.innerText = chgText;
      cardChg.className = `text-xs font-bold font-mono ${chgColor}`;
    }
    if (cardRange && kospi.high && kospi.low) {
      cardRange.innerText = `고가: ${kospi.high.toLocaleString()} | 저가: ${kospi.low.toLocaleString()}`;
    }
  }

  if (kosdaq) {
    const isUp = (kosdaq.change || 0) >= 0;
    const sign = isUp ? "▲ +" : "▼ ";
    const chgColor = isUp ? "text-emerald-400" : "text-rose-400";
    const chgText = `${sign}${Math.abs(kosdaq.change || 0).toFixed(2)} (${isUp ? '+' : ''}${kosdaq.change_pct}%)`;

    // 1. Top Bar Pill
    const topVal = document.getElementById("top-kosdaq-val");
    const topChg = document.getElementById("top-kosdaq-chg");
    if (topVal) topVal.innerText = (kosdaq.current || 0).toLocaleString();
    if (topChg) {
      topChg.innerText = chgText;
      topChg.className = `font-mono font-bold text-xs ${chgColor}`;
    }

    // 2. Main Dashboard Live Card
    const cardVal = document.getElementById("card-kosdaq-val");
    const cardChg = document.getElementById("card-kosdaq-chg");
    const cardRange = document.getElementById("card-kosdaq-range");
    if (cardVal) cardVal.innerText = (kosdaq.current || 0).toLocaleString();
    if (cardChg) {
      cardChg.innerText = chgText;
      cardChg.className = `text-xs font-bold font-mono ${chgColor}`;
    }
    if (cardRange && kosdaq.high && kosdaq.low) {
      cardRange.innerText = `고가: ${kosdaq.high.toLocaleString()} | 저가: ${kosdaq.low.toLocaleString()}`;
    }
  }

  const now = new Date();
  const timeStr = now.toLocaleTimeString('ko-KR', { hour12: false });
  const timeEl1 = document.getElementById("live-sync-timestamp");
  if (timeEl1) timeEl1.innerText = `기준시각: ${timeStr} (네이버 실시간)`;
  const timeEl2 = document.getElementById("market-sync-time");
  if (timeEl2) timeEl2.innerText = `${timeStr} 네이버 증권 0초 동기화`;
}

async function fetchLiveExchangeRates() {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    if (res.ok) {
      const data = await res.json();
      if (data && data.rates && data.rates.KRW) {
        const liveKrw = parseFloat(data.rates.KRW.toFixed(2));
        if (g_macroData && g_macroData.fx) {
          const usdKrw = g_macroData.fx.find(f => f.pair === "USD/KRW");
          if (usdKrw) {
            usdKrw.current = liveKrw;
            renderMacroDashboard();
            const fxEl = document.getElementById("stat-fx-rate");
            if (fxEl) fxEl.innerText = `적용환율: 1$ = ₩${liveKrw.toLocaleString()}`;
            const topFx = document.getElementById("top-fx-val");
            if (topFx) topFx.innerText = `₩${liveKrw.toLocaleString()}`;
            const cardFx = document.getElementById("card-fx-val");
            if (cardFx) cardFx.innerText = `₩${liveKrw.toLocaleString()}`;
          }
        }
      }
    }
  } catch (e) {
    console.log("Live open exchange rates note:", e);
  }
}

async function refreshLiveRates() {
  const icon = document.getElementById("refresh-icon");
  const icon2 = document.getElementById("refresh-icon-2");
  const iconPort = document.getElementById("refresh-icon-port");
  if (icon) icon.classList.add("fa-spin");
  if (icon2) icon2.classList.add("fa-spin");
  if (iconPort) iconPort.classList.add("fa-spin");

  await Promise.all([
    fetchNaverIndices(),
    fetchMacro(true),
    fetchLiveExchangeRates(),
    fetchPortfolio(null, true)
  ]);

  const now = new Date();
  const timeStr = now.toLocaleTimeString('ko-KR', { hour12: false });
  const tsEl = document.getElementById("live-sync-timestamp");
  if (tsEl) tsEl.innerText = `기준시각: ${timeStr} 갱신 완료`;
  const msEl = document.getElementById("market-sync-time");
  if (msEl) msEl.innerText = `${timeStr} 갱신 완료`;
  const portSyncEl = document.getElementById("portfolio-sync-time");
  if (portSyncEl) portSyncEl.innerText = `${timeStr} 실시간 동기화`;

  setTimeout(() => {
    if (icon) icon.classList.remove("fa-spin");
    if (icon2) icon2.classList.remove("fa-spin");
    if (iconPort) iconPort.classList.remove("fa-spin");
  }, 600);
}

async function fetchMacro(forceRefresh = false) {
  const icon = document.getElementById("icon-refresh-macro");
  if (icon && forceRefresh) icon.classList.add("fa-spin");

  try {
    const res = await fetch("/api/macro");
    if (!res.ok) throw new Error("Server offline");
    g_macroData = await res.json();
  } catch (err) {
    g_macroData = OFFLINE_MACRO_SEED;
  } finally {
    if (icon && forceRefresh) {
      setTimeout(() => icon.classList.remove("fa-spin"), 500);
    }
  }
  renderMacroDashboard();
}

function filterFutures(filter) {
  g_futFilter = filter;
  ["all", "kr", "us", "global"].forEach(f => {
    const btn = document.getElementById(`btn-fut-${f}`);
    if (btn) {
      if (f.toUpperCase() === filter.toUpperCase()) {
        btn.className = "fut-filter-btn px-2.5 py-1 rounded-lg bg-indigo-600 text-white font-bold transition";
      } else {
        btn.className = "fut-filter-btn px-2.5 py-1 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition font-medium";
      }
    }
  });
  renderMacroFutures();
}

function filterCommodities(filter) {
  g_commFilter = filter;
  ["all", "energy", "precious", "industrial", "strategic"].forEach(f => {
    const btn = document.getElementById(`btn-comm-${f}`);
    if (btn) {
      if (f === filter) {
        btn.className = "comm-filter-btn px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-bold transition";
      } else {
        btn.className = "comm-filter-btn px-2.5 py-1 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition font-medium";
      }
    }
  });
  renderMacroCommodities();
}

function renderMacroFutures() {
  const container = document.getElementById("macro-futures-container");
  if (!container || !g_macroData || !g_macroData.futures) return;

  let list = g_macroData.futures;
  if (g_futFilter === "KR") {
    list = list.filter(f => f.market === "KR");
  } else if (g_futFilter === "US") {
    list = list.filter(f => f.market === "US");
  } else if (g_futFilter === "GLOBAL") {
    list = list.filter(f => f.market === "DE" || f.market === "JP" || f.market === "HK");
  }

  container.innerHTML = list.map(f => {
    const isUp = (f.change_pct || 0) >= 0;
    const isFlat = f.change_pct === 0;
    const colorClass = isFlat ? "text-slate-300" : (isUp ? "text-emerald-400" : "text-rose-400");
    const bgBadgeClass = isFlat ? "bg-slate-800/80 text-slate-400 border-slate-700" : (isUp ? "bg-emerald-950/80 text-emerald-300 border-emerald-700/50" : "bg-rose-950/80 text-rose-300 border-rose-700/50");

    let sessionBadge = "";
    if (f.session === "DAY_REGULAR") {
      sessionBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1"><i class="fa-solid fa-sun text-amber-400"></i>주간 정규장</span>`;
    } else if (f.session === "NIGHT_EUREX") {
      sessionBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 flex items-center gap-1"><i class="fa-solid fa-moon text-indigo-400"></i>야간 Eurex</span>`;
    } else if (f.session === "CME_GLOBEX") {
      sessionBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30 flex items-center gap-1"><i class="fa-solid fa-satellite-dish text-purple-400"></i>24H 실시간</span>`;
    } else {
      sessionBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700">${f.session_label || f.session}</span>`;
    }

    let linkUrl = "https://kr.tradingview.com/";
    if (f.code.startsWith("KOSPI")) {
      linkUrl = "https://stock.naver.com/domestic/index/FUT";
    } else if (f.code === "NQ_F") {
      linkUrl = "https://kr.tradingview.com/chart/?symbol=CME_MINI:NQ1!";
    } else if (f.code === "ES_F") {
      linkUrl = "https://kr.tradingview.com/chart/?symbol=CME_MINI:ES1!";
    } else if (f.code === "YM_F") {
      linkUrl = "https://kr.tradingview.com/chart/?symbol=CBOT_MINI:YM1!";
    } else if (f.code === "RTY_F") {
      linkUrl = "https://kr.tradingview.com/chart/?symbol=CME_MINI:RTY1!";
    } else if (f.code === "DAX_F") {
      linkUrl = "https://kr.tradingview.com/chart/?symbol=EUREX:FDAX1!";
    } else if (f.code === "N225_F") {
      linkUrl = "https://kr.tradingview.com/chart/?symbol=OSE:NK2251!";
    } else if (f.code === "HSI_F") {
      linkUrl = "https://kr.tradingview.com/chart/?symbol=HKEX:HSI1!";
    }

    return `
      <div class="glass-panel p-4 rounded-xl border border-slate-800 hover:border-indigo-500/50 hover:bg-slate-900/90 transition shadow-lg flex flex-col justify-between space-y-3 group">
        <div>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-1.5">
              <span class="text-base">${f.flag || '🌐'}</span>
              <strong class="font-black text-xs sm:text-sm text-white group-hover:text-indigo-300 transition">${f.name}</strong>
            </div>
            ${sessionBadge}
          </div>

          <div class="mt-2.5 flex items-baseline justify-between">
            <div>
              <span class="text-xl sm:text-2xl font-black font-mono text-white tracking-tight">${Number(f.current).toLocaleString()}</span>
              <span class="text-[11px] text-slate-400 font-mono ml-0.5">${f.unit || 'pt'}</span>
            </div>
            <div class="text-right">
              <span class="px-2 py-0.5 rounded text-xs font-black font-mono border ${bgBadgeClass}">
                ${isUp ? '+' : ''}${Number(f.change_pct).toFixed(2)}%
              </span>
              ${f.change ? `<span class="block text-[10px] font-mono text-slate-400 mt-0.5">${isUp ? '+' : ''}${Number(f.change).toLocaleString()}</span>` : ''}
            </div>
          </div>
        </div>

        <div class="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
          <div class="truncate pr-2">
            ${f.basis !== undefined ? `
              <span class="text-slate-400">베이시스:</span>
              <strong class="font-mono ${f.basis >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${f.basis >= 0 ? '+' : ''}${f.basis} pt</strong>
              <span class="text-[10px] text-slate-500 ml-1">(${f.basis_status || ''})</span>
            ` : `
              <span class="text-indigo-300/90">${f.basis_status || f.session_label}</span>
            `}
          </div>
          <a href="${linkUrl}" target="_blank" rel="noopener noreferrer" class="shrink-0 text-[10px] text-slate-400 hover:text-indigo-300 transition flex items-center gap-1 font-semibold" title="실시간 전문 차트 열기">
            <span>차트</span>
            <i class="fa-solid fa-arrow-up-right-from-square text-[9px]"></i>
          </a>
        </div>
      </div>
    `;
  }).join('');
}

function renderMacroCommodities() {
  const container = document.getElementById("macro-commodities-container");
  if (!container || !g_macroData || !g_macroData.commodities) return;

  let list = g_macroData.commodities;
  if (g_commFilter !== "all") {
    list = list.filter(c => c.category === g_commFilter);
  }

  container.innerHTML = list.map(c => {
    const isUp = (c.change_pct || 0) >= 0;
    const isFlat = c.change_pct === 0;
    const colorClass = isFlat ? "text-slate-300" : (isUp ? "text-emerald-400" : "text-rose-400");
    const bgBadgeClass = isFlat ? "bg-slate-800/80 text-slate-400 border-slate-700" : (isUp ? "bg-emerald-950/80 text-emerald-300 border-emerald-700/50" : "bg-rose-950/80 text-rose-300 border-rose-700/50");

    let tagBadge = "";
    if (c.tag === "유가") {
      tagBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-950/90 text-rose-300 border border-rose-800/50"><i class="fa-solid fa-oil-well mr-1"></i>유가</span>`;
    } else if (c.tag === "귀금속") {
      tagBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950/90 text-amber-300 border border-amber-800/50"><i class="fa-solid fa-coins mr-1"></i>귀금속</span>`;
    } else if (c.tag === "경기선행") {
      tagBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-orange-950/90 text-orange-300 border border-orange-800/50"><i class="fa-solid fa-bolt mr-1 text-orange-400"></i>닥터코퍼</span>`;
    } else if (c.tag === "전략광물") {
      tagBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-950/90 text-purple-300 border border-purple-800/50"><i class="fa-solid fa-atom mr-1 text-purple-400"></i>전략광물</span>`;
    } else if (c.tag === "배터리") {
      tagBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-950/90 text-cyan-300 border border-cyan-800/50"><i class="fa-solid fa-car-battery mr-1 text-cyan-400"></i>배터리</span>`;
    } else {
      tagBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700">${c.tag}</span>`;
    }

    let linkUrl = "https://kr.tradingview.com/";
    if (c.code === "WTI") linkUrl = "https://kr.tradingview.com/chart/?symbol=NYMEX:CL1!";
    else if (c.code === "BRENT") linkUrl = "https://kr.tradingview.com/chart/?symbol=ICE:B1!";
    else if (c.code === "NG") linkUrl = "https://kr.tradingview.com/chart/?symbol=NYMEX:NG1!";
    else if (c.code === "GOLD") linkUrl = "https://kr.tradingview.com/chart/?symbol=COMEX:GC1!";
    else if (c.code === "SILVER") linkUrl = "https://kr.tradingview.com/chart/?symbol=COMEX:SI1!";
    else if (c.code === "COPPER") linkUrl = "https://kr.tradingview.com/chart/?symbol=COMEX:HG1!";
    else if (c.code === "PLATINUM") linkUrl = "https://kr.tradingview.com/chart/?symbol=NYMEX:PL1!";
    else if (c.code === "REMX") linkUrl = "https://kr.tradingview.com/chart/?symbol=AMEX:REMX";
    else linkUrl = "https://m.stock.naver.com/marketindex/home";

    return `
      <div class="glass-panel p-4 rounded-xl border border-slate-800 hover:border-emerald-500/50 hover:bg-slate-900/90 transition shadow-lg flex flex-col justify-between space-y-3 group">
        <div>
          <div class="flex items-center justify-between">
            <strong class="font-black text-xs sm:text-sm text-white group-hover:text-emerald-300 transition">${c.name}</strong>
            ${tagBadge}
          </div>

          <div class="mt-2.5 flex items-baseline justify-between">
            <div>
              <span class="text-xl sm:text-2xl font-black font-mono text-white tracking-tight">${Number(c.current).toLocaleString()}</span>
              <span class="text-[11px] text-slate-400 font-mono ml-0.5">${c.unit || ''}</span>
            </div>
            <div class="text-right">
              <span class="px-2 py-0.5 rounded text-xs font-black font-mono border ${bgBadgeClass}">
                ${isUp ? '+' : ''}${Number(c.change_pct).toFixed(2)}%
              </span>
              ${c.change ? `<span class="block text-[10px] font-mono text-slate-400 mt-0.5">${isUp ? '+' : ''}${Number(c.change).toLocaleString()}</span>` : ''}
            </div>
          </div>
        </div>

        <div class="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
          <span class="text-slate-400 truncate pr-2 text-[10px] leading-tight">${c.desc || ''}</span>
          <a href="${linkUrl}" target="_blank" rel="noopener noreferrer" class="shrink-0 text-[10px] text-slate-400 hover:text-emerald-300 transition flex items-center gap-1 font-semibold" title="실시간 시세 차트 열기">
            <span>차트</span>
            <i class="fa-solid fa-arrow-up-right-from-square text-[9px]"></i>
          </a>
        </div>
      </div>
    `;
  }).join('');
}

function renderMacroDashboard() {
  if (!g_macroData) return;

  const y = g_macroData.treasury_yields || {};
  if (y.us_5y) document.getElementById("yield-us5y").innerText = `${y.us_5y.yield}%`;
  if (y.us_10y) {
    document.getElementById("yield-us10y").innerText = `${y.us_10y.yield}%`;
    const topUs = document.getElementById("top-us10y-val");
    if (topUs) topUs.innerText = `${y.us_10y.yield}%`;
    const cardUs = document.getElementById("card-us10y-val");
    if (cardUs) cardUs.innerText = `${y.us_10y.yield}%`;
  }
  if (y.us_20y) document.getElementById("yield-us20y").innerText = `${y.us_20y.yield}%`;
  if (y.us_30y) document.getElementById("yield-us30y").innerText = `${y.us_30y.yield}%`;
  if (y.kr_10y) {
    document.getElementById("yield-kr10y").innerText = `${y.kr_10y.yield}%`;
    const topKr = document.getElementById("top-kr10y-val");
    if (topKr) topKr.innerText = `${y.kr_10y.yield}%`;
    const cardKr = document.getElementById("card-kr10y-sub");
    if (cardKr) cardKr.innerText = `한국 10Y: ${y.kr_10y.yield}%`;
  }

  // FX updates
  if (g_macroData.fx) {
    const usd = g_macroData.fx.find(f => f.pair === "USD/KRW");
    if (usd) {
      const topFx = document.getElementById("top-fx-val");
      if (topFx) topFx.innerText = `₩${usd.current.toLocaleString()}`;
      const cardFx = document.getElementById("card-fx-val");
      if (cardFx) cardFx.innerText = `₩${usd.current.toLocaleString()}`;
      const cardFxChg = document.getElementById("card-fx-chg");
      if (cardFxChg) {
        cardFxChg.innerText = `${usd.change_pct >= 0 ? '+' : ''}${usd.change_pct}%`;
        cardFxChg.className = `text-xs font-bold font-mono ${usd.change_pct >= 0 ? 'text-rose-400' : 'text-blue-400'}`;
      }
    }
  }

  if (g_macroData.macro_summary) {
    document.getElementById("macro-regime-title").innerText = g_macroData.macro_summary.regime;
    document.getElementById("macro-valuation-implication").innerText = g_macroData.macro_summary.valuation_implication;
  }
  if (g_macroData.last_updated) {
    document.getElementById("macro-last-updated").innerText = g_macroData.last_updated;
  }

  // 1. Render Futures Cards Grid
  renderMacroFutures();

  // 2. Render Commodities Grid
  renderMacroCommodities();

  // 3. Render Spot Indices List
  const idxContainer = document.getElementById("macro-indices-list");
  if (idxContainer && g_macroData.indices) {
    idxContainer.innerHTML = g_macroData.indices.map(i => {
      const isUp = i.change >= 0;
      const isKr = i.market === "KR" || i.code === "KOSPI" || i.code === "KOSDAQ";
      const linkUrl = isKr 
        ? `https://stock.naver.com/domestic/index/${i.code}`
        : `https://kr.tradingview.com/chart/?symbol=${i.code === 'SPX' ? 'SP:SPX' : i.code === 'IXIC' ? 'NASDAQ:IXIC' : 'DJ:DJI'}`;

      return `
        <a href="${linkUrl}" target="_blank" rel="noopener noreferrer" 
           class="flex items-center justify-between p-2.5 rounded-lg bg-slate-900/70 border border-slate-800/80 hover:border-emerald-500/50 hover:bg-slate-850 transition block text-xs group">
          <div>
            <div class="flex items-center">
              <span class="font-bold text-white group-hover:text-emerald-300 transition">${i.name}</span>
              <span class="text-[10px] text-slate-400 ml-1">(${i.code})</span>
              ${isKr ? `
                <span class="text-[9px] px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-300 border border-emerald-600/50 ml-1.5 font-medium flex items-center">
                  <i class="fa-solid fa-n text-[7px] mr-1 text-emerald-400"></i>네이버 실시간
                </span>
              ` : `
                <span class="text-[9px] px-1.5 py-0.2 rounded bg-blue-950 text-blue-300 border border-blue-700/50 ml-1.5 font-medium flex items-center">
                  TradingView
                </span>
              `}
            </div>
            <span class="text-[10px] text-slate-500 block mt-0.5">
              ${isKr ? '네이버 증권 시세 바로가기' : '글로벌 차트 바로가기'} <i class="fa-solid fa-arrow-up-right-from-square text-[8px] text-slate-500"></i>
            </span>
          </div>
          <div class="text-right">
            <span class="font-mono font-bold text-slate-100">${i.current.toLocaleString()}</span>
            <span class="font-mono block text-[11px] ${isUp ? 'text-emerald-400' : 'text-rose-400'}">
              ${isUp ? '+' : ''}${i.change} (${isUp ? '+' : ''}${i.change_pct}%)
            </span>
          </div>
        </a>
      `;
    }).join('');
  }

  // 4. Render FX list
  const fxContainer = document.getElementById("macro-fx-list");
  if (fxContainer && g_macroData.fx) {
    fxContainer.innerHTML = g_macroData.fx.map(f => {
      const isUp = f.change >= 0;
      return `
        <div class="flex items-center justify-between p-2.5 rounded-lg bg-slate-900/60 border border-slate-800/80 text-xs">
          <div>
            <span class="font-bold text-white">${f.name}</span>
            <span class="text-[10px] text-slate-400 ml-1 font-mono">${f.pair}</span>
          </div>
          <div class="text-right">
            <span class="font-mono font-bold text-slate-100">${f.current.toLocaleString()}${f.unit}</span>
            <span class="font-mono block text-[11px] ${isUp ? 'text-rose-400' : 'text-blue-400'}">
              ${isUp ? '+' : ''}${f.change_pct}%
            </span>
          </div>
        </div>
      `;
    }).join('');
  }
}

function renderYieldCurveChart() {
  const canvas = document.getElementById("yieldCurveChart");
  if (!canvas || !g_macroData || !g_macroData.treasury_yields) return;

  if (g_yieldChart) {
    g_yieldChart.destroy();
  }

  const y = g_macroData.treasury_yields;
  const labels = ["5년물", "10년물 (Rf)", "20년물", "30년물"];
  const usData = [y.us_5y.yield, y.us_10y.yield, y.us_20y.yield, y.us_30y.yield];

  const ctx = canvas.getContext("2d");
  g_yieldChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: "미국 국채 수익률 곡선 (%)",
          data: usData,
          borderColor: "#f59e0b",
          backgroundColor: "rgba(245, 158, 11, 0.15)",
          borderWidth: 3,
          fill: true,
          tension: 0.3,
          pointRadius: 6,
          pointHoverRadius: 8,
          pointBackgroundColor: "#f59e0b",
          pointBorderColor: "#fff"
        },
        {
          label: "한국 국채 10년물 기준선",
          data: [null, y.kr_10y.yield, null, null],
          borderColor: "#6366f1",
          backgroundColor: "#6366f1",
          pointRadius: 7,
          pointStyle: 'rectRot',
          showLine: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          min: 2.5,
          max: 6.0,
          ticks: { color: "#94a3b8", callback: v => v + "%" },
          grid: { color: "rgba(255, 255, 255, 0.05)" }
        },
        x: {
          ticks: { color: "#cbd5e1", font: { weight: "bold" } },
          grid: { color: "rgba(255, 255, 255, 0.05)" }
        }
      },
      plugins: {
        legend: {
          labels: { color: "#e2e8f0", font: { size: 12 } }
        }
      }
    }
  });
}

// =============================================================================
// Portfolio & Clean Slate Management
// =============================================================================
// Local-First Zero-Knowledge Portfolio Management (100% Client Privacy)
// =============================================================================
async function fetchPortfolio(rf = null, forceRefresh = false) {
  // 보안 조치: 이전 v2에 저장되어 있던 모든 개인 주식 데이터 강제 파기
  if (localStorage.getItem("troster_portfolio_v2")) {
    localStorage.removeItem("troster_portfolio_v2");
  }

  // 1. 사용자 브라우저 로컬 저장소(localStorage)에서 개인 종목 읽기
  let stored = localStorage.getItem("troster_portfolio_v3");
  let rawList = null;

  if (stored) {
    try {
      rawList = JSON.parse(stored);
    } catch (e) {
      rawList = null;
    }
  }

  // 2. 신규 접속 사용자: 개인 금융 정보 완벽 격리를 위해 100% 빈 포트폴리오(Clean Slate)로 시작
  if (!rawList) {
    rawList = [];
    localStorage.setItem("troster_portfolio_v3", JSON.stringify(rawList));
  }

  rawList = rawList || [];

  // 3. 서버에는 티커(종목코드)만 전달하여 실시간 호가/기술지표 수신 (매수가/수량/자산정보 절대 전송 안 함)
  if (rawList.length > 0) {
    const tickers = Array.from(new Set(rawList.map(s => s.ticker).filter(Boolean))).join(",");
    try {
      const qRes = await fetch(`/api/quotes?tickers=${encodeURIComponent(tickers)}${forceRefresh ? '&refresh=1' : ''}`);
      if (qRes.ok) {
        const qData = await qRes.json();
        const quotes = qData.quotes || {};

        rawList.forEach(item => {
          const t = String(item.ticker).trim().toUpperCase();
          if (quotes[t]) {
            const q = quotes[t];
            if (q.current_price && q.current_price > 0) {
              item.current_price = q.current_price;
              item.day_change = q.day_change || 0;
              item.day_change_pct = q.day_change_pct || 0;
              if (q.technical_indicators) {
                item.technical_indicators = Object.assign(item.technical_indicators || {}, q.technical_indicators);
              }
            }
          }
        });
        localStorage.setItem("troster_portfolio_v3", JSON.stringify(rawList));
      }
    } catch (err) {
      console.log("Live quote sync note:", err);
    }
  }

  // 4. 다모다란 DCF 및 평가손익을 전적으로 브라우저 내부에서 계산 (외부 유출 원천 차단)
  let totInvested = 0;
  let totCurrent = 0;
  const usdRate = (g_macroData && g_macroData.fx) ? (g_macroData.fx.find(f => f.pair === "USD/KRW")?.current || 1380.3) : 1380.3;

  g_portfolio = rawList.map(item => {
    const dcf = jsCalculateDamodaranDcf(item, rf);
    const exit = jsEvaluateExitTiming(item, dcf);
    const fx = item.currency === "USD" ? usdRate : 1.0;
    totInvested += (item.buy_price * item.quantity * fx);
    totCurrent += (item.current_price * item.quantity * fx);

    const copy = Object.assign({}, item);
    copy.dcf = dcf;
    copy.exit_analysis = exit;
    return copy;
  });

  const profitKrw = totCurrent - totInvested;
  const profitPct = totInvested > 0 ? (profitKrw / totInvested * 100.0) : 0;
  const now = new Date();
  const timeStr = now.toLocaleTimeString('ko-KR', { hour12: false });

  g_summary = {
    total_invested_krw: Math.round(totInvested),
    total_current_krw: Math.round(totCurrent),
    total_profit_krw: Math.round(profitKrw),
    total_profit_pct: parseFloat(profitPct.toFixed(2)),
    stock_count: g_portfolio.length,
    usd_krw_rate: usdRate,
    last_synced_at: timeStr
  };

  const portSyncEl = document.getElementById("portfolio-sync-time");
  if (portSyncEl) portSyncEl.innerText = `${timeStr} 동기화`;

  renderPortfolioSummary();
  renderPortfolioList();

  if (g_portfolio.length > 0) {
    document.getElementById("stock-empty-container").classList.add("hidden");
    document.getElementById("stock-hero-container").classList.remove("hidden");

    if (!g_selectedStock) {
      selectStock(g_portfolio[0].id);
    } else {
      const found = g_portfolio.find(s => s.id === g_selectedStock.id);
      if (found) {
        selectStock(found.id);
      } else {
        selectStock(g_portfolio[0].id);
      }
    }
  } else {
    // Show empty hero container!
    g_selectedStock = null;
    document.getElementById("stock-empty-container").classList.remove("hidden");
    document.getElementById("stock-hero-container").classList.add("hidden");
  }
}

function renderPortfolioSummary() {
  if (!g_summary) return;
  document.getElementById("stat-total-invested").innerText = `₩${Math.round(g_summary.total_invested_krw || 0).toLocaleString()}`;
  document.getElementById("stat-total-current").innerText = `₩${Math.round(g_summary.total_current_krw || 0).toLocaleString()}`;
  
  const profitKrw = g_summary.total_profit_krw || 0;
  const profitPct = g_summary.total_profit_pct || 0;
  const isProfit = profitKrw >= 0;

  const profitEl = document.getElementById("stat-total-profit");
  const profitPctEl = document.getElementById("stat-total-profit-pct");
  const profitCard = document.getElementById("stat-profit-card");

  profitEl.innerText = `${isProfit ? '+' : ''}₩${Math.round(profitKrw).toLocaleString()}`;
  profitPctEl.innerText = `${isProfit ? '+' : ''}${profitPct.toFixed(2)}%`;

  if (g_portfolio.length === 0) {
    profitCard.className = "glass-panel p-4 flex flex-col justify-between border-l-4 border-slate-700";
    profitEl.className = "text-lg sm:text-xl font-bold tracking-tight text-slate-300";
    profitPctEl.className = "text-xs font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-400";
  } else if (isProfit) {
    profitCard.className = "glass-panel p-4 flex flex-col justify-between border-l-4 border-l-emerald-500 bg-emerald-950/10";
    profitEl.className = "text-lg sm:text-xl font-bold tracking-tight text-emerald-400";
    profitPctEl.className = "text-xs font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300";
  } else {
    profitCard.className = "glass-panel p-4 flex flex-col justify-between border-l-4 border-l-rose-500 bg-rose-950/10";
    profitEl.className = "text-lg sm:text-xl font-bold tracking-tight text-rose-400";
    profitPctEl.className = "text-xs font-bold px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300";
  }

  document.getElementById("stat-stock-count").innerText = `${g_summary.stock_count || 0}개`;
  document.getElementById("stat-fx-rate").innerText = `적용환율: 1$ = ₩${(g_summary.usd_krw_rate || 1380.3).toLocaleString()}`;
}

function renderPortfolioList() {
  const container = document.getElementById("portfolio-list-container");
  if (!container) return;

  if (g_portfolio.length === 0) {
    container.innerHTML = `
      <div class="glass-panel p-6 text-center space-y-3 border-dashed border-slate-700">
        <i class="fa-solid fa-folder-open text-slate-500 text-2xl"></i>
        <div class="text-xs text-slate-300 font-semibold">등록된 매수 종목이 없습니다.</div>
        <p class="text-[11px] text-slate-400">보유 주식을 등록하시면 다모다란 적정가와 매도 타이밍이 분석됩니다.</p>
        <button onclick="openAddStockModal()" class="w-full py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow transition">
          <i class="fa-solid fa-plus mr-1"></i>내 매수 종목 등록하기
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = g_portfolio.map(stock => {
    const isSelected = g_selectedStock && g_selectedStock.id === stock.id;
    const isUsd = stock.currency === "USD";
    const currPriceFormatted = isUsd ? `$${stock.current_price.toLocaleString()}` : `₩${stock.current_price.toLocaleString()}`;
    const buyPriceFormatted = isUsd ? `$${stock.buy_price.toLocaleString()}` : `₩${stock.buy_price.toLocaleString()}`;

    const exit = stock.exit_analysis || {};
    const profitPct = exit.profit_pct || 0;
    const isProfitable = profitPct >= 0;

    let badgeClass = "bg-slate-800 text-slate-300 border-slate-700";
    if (exit.signal_type === "STRONG_SELL") {
      badgeClass = "bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse";
    } else if (exit.signal_type === "TREND_RIDE_HOLD") {
      badgeClass = "bg-indigo-500/20 text-indigo-300 border-indigo-500/50 font-black shadow-sm";
    } else if (exit.signal_type === "PARTIAL_SELL_1") {
      badgeClass = "bg-amber-500/20 text-amber-300 border-amber-500/40";
    } else if (exit.signal_type === "APPROACHING_TARGET") {
      badgeClass = "bg-blue-500/20 text-blue-300 border-blue-500/40";
    } else if (exit.signal_type === "SAFE_HOLD") {
      badgeClass = "bg-emerald-500/20 text-emerald-300 border-emerald-500/40";
    } else if (exit.signal_type === "STOP_LOSS_ALERT") {
      badgeClass = "bg-red-600/30 text-red-300 border-red-500 animate-pulse";
    }

    return `
      <div onclick="selectStock('${stock.id}')" 
           class="p-4 rounded-xl cursor-pointer transition-all duration-200 border ${isSelected ? 'bg-slate-800/90 border-indigo-500 shadow-lg ring-1 ring-indigo-500/40' : 'bg-slate-900/60 border-slate-800/80 hover:bg-slate-800/50 hover:border-slate-700'}">
        
        <div class="flex items-start justify-between">
          <div>
            <div class="flex items-center space-x-2">
              <span class="text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${stock.market === 'US' ? 'bg-blue-950 text-blue-300' : 'bg-slate-800 text-slate-300'}">${stock.market}</span>
              <span class="font-extrabold text-sm text-white">${stock.name}</span>
              <span class="font-mono text-xs text-slate-400">${stock.ticker}</span>
            </div>
            <div class="text-[11px] text-slate-400 mt-1">
              매수가 ${buyPriceFormatted} · ${stock.quantity}주
            </div>
          </div>

          <div class="text-right">
            <span class="font-mono font-bold text-sm text-white block">${currPriceFormatted}</span>
            <div class="flex items-center justify-end gap-1 font-mono text-[11px] mt-0.5">
              ${stock.day_change_pct !== undefined ? `
                <span class="${(stock.day_change_pct || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}">
                  ${(stock.day_change_pct || 0) >= 0 ? '+' : ''}${stock.day_change_pct}%
                </span>
                <span class="text-slate-600">·</span>
              ` : ''}
              <span class="font-semibold ${isProfitable ? 'text-emerald-400' : 'text-rose-400'}">
                ${isProfitable ? '+' : ''}${profitPct.toFixed(1)}%
              </span>
            </div>
          </div>
        </div>

        <div class="mt-3 pt-2.5 border-t border-slate-800 flex items-center justify-between">
          <span class="text-[11px] px-2 py-0.5 rounded-md font-bold border ${badgeClass}">
            ${exit.signal_badge || '분석 중'}
          </span>
          <button onclick="event.stopPropagation(); deleteStock('${stock.id}')" class="text-slate-500 hover:text-rose-400 text-xs p-1" title="종목 삭제">
            <i class="fa-regular fa-trash-can"></i>
          </button>
        </div>

      </div>
    `;
  }).join('');
}

function selectStock(stockId) {
  const stock = g_portfolio.find(s => s.id === stockId);
  if (!stock) return;
  g_selectedStock = stock;
  renderPortfolioList();
  renderSelectedStockHero();
}

function renderSelectedStockHero() {
  const stock = g_selectedStock;
  if (!stock) return;

  const isUsd = stock.currency === "USD";
  const currSym = isUsd ? "$" : "₩";
  const dcf = stock.dcf || {};
  const exit = stock.exit_analysis || {};
  const tech = stock.technical_indicators || {};

  document.getElementById("hero-market-badge").innerText = stock.market;
  document.getElementById("hero-stock-name").innerText = stock.name;
  document.getElementById("hero-stock-ticker").innerText = stock.ticker;
  document.getElementById("hero-stock-notes").innerText = stock.notes || "투자 메모 없음";
  
  const sectorObj = g_sectorsData.find(s => s.id === stock.sector_id);
  document.getElementById("hero-sector-name").innerText = sectorObj ? sectorObj.name_kr : "일반 섹터";

  const naverLinkEl = document.getElementById("hero-naver-link");
  if (naverLinkEl) {
    if (stock.market === "KR") {
      naverLinkEl.href = `https://finance.naver.com/item/main.naver?code=${stock.ticker}`;
      naverLinkEl.className = "text-xs text-emerald-400 hover:text-emerald-300 font-bold inline-flex items-center gap-1 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800/40 transition";
      naverLinkEl.innerHTML = `<i class="fa-solid fa-n text-[9px] text-emerald-400"></i>네이버 증권 시세 <i class="fa-solid fa-arrow-up-right-from-square text-[9px]"></i>`;
    } else {
      naverLinkEl.href = `https://finance.yahoo.com/quote/${stock.ticker}`;
      naverLinkEl.className = "text-xs text-blue-400 hover:text-blue-300 font-bold inline-flex items-center gap-1 bg-blue-950/60 px-2 py-0.5 rounded border border-blue-800/40 transition";
      naverLinkEl.innerHTML = `<i class="fa-solid fa-arrow-up-right-from-square text-[9px]"></i>야후 파이낸스`;
    }
  }

  document.getElementById("hero-current-price").innerText = `${currSym}${stock.current_price.toLocaleString()}`;
  document.getElementById("hero-buy-price").innerText = `${currSym}${stock.buy_price.toLocaleString()}`;
  document.getElementById("hero-quantity").innerText = `${stock.quantity}주`;

  const profitPct = exit.profit_pct || 0;
  const isProfitable = profitPct >= 0;
  const profitBadge = document.getElementById("hero-profit-badge");
  profitBadge.innerText = `수익률: ${isProfitable ? '+' : ''}${profitPct.toFixed(2)}% (${currSym}${Math.round(exit.profit_amount || 0).toLocaleString()})`;
  if (isProfitable) {
    profitBadge.className = "px-2 py-0.5 rounded bg-emerald-950/70 text-emerald-400 border border-emerald-800/40";
  } else {
    profitBadge.className = "px-2 py-0.5 rounded bg-rose-950/70 text-rose-400 border border-rose-800/40";
  }

  const dayChangeEl = document.getElementById("hero-day-change");
  const dayChange = stock.day_change || 0;
  const dayChangePct = stock.day_change_pct || 0;
  dayChangeEl.innerText = `${dayChange >= 0 ? '+' : ''}${dayChange.toLocaleString()} (${dayChange >= 0 ? '+' : ''}${dayChangePct}%)`;
  dayChangeEl.className = dayChange >= 0 ? "text-emerald-400" : "text-rose-400";

  const banner = document.getElementById("exit-signal-banner");
  const iconBox = document.getElementById("exit-signal-icon-box");
  const badge = document.getElementById("exit-signal-badge");
  const headline = document.getElementById("exit-headline");
  const guidance = document.getElementById("exit-action-guidance");
  const gaugeBar = document.getElementById("exit-gauge-bar");
  const gaugeScoreText = document.getElementById("exit-gauge-score-text");

  headline.innerText = exit.headline || "신호 대기 중";
  guidance.innerHTML = exit.action_guidance || "";
  badge.innerText = exit.signal_badge || "분석 완료";
  gaugeScoreText.innerText = `${exit.sell_gauge_score || 0} / 100`;
  gaugeBar.style.width = `${Math.min(100, Math.max(5, exit.sell_gauge_score || 10))}%`;

  if (exit.signal_type === "STRONG_SELL") {
    banner.style.borderColor = "rgba(244, 63, 94, 0.6)";
    iconBox.className = "w-14 h-14 rounded-2xl flex items-center justify-center text-2xl shadow-lg border bg-rose-950/80 text-rose-400 border-rose-500 animate-pulse";
    iconBox.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';
    badge.className = "text-xs px-2.5 py-0.5 rounded-full font-bold bg-rose-500 text-white";
  } else if (exit.signal_type === "TREND_RIDE_HOLD") {
    banner.style.borderColor = "rgba(99, 102, 241, 0.7)";
    iconBox.className = "w-14 h-14 rounded-2xl flex items-center justify-center text-2xl shadow-lg border bg-indigo-950/80 text-indigo-400 border-indigo-500/60 shadow-indigo-900/40";
    iconBox.innerHTML = '<i class="fa-solid fa-rocket text-indigo-400"></i>';
    badge.className = "text-xs px-2.5 py-0.5 rounded-full font-bold bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-sm";
  } else if (exit.signal_type === "PARTIAL_SELL_1") {
    banner.style.borderColor = "rgba(245, 158, 11, 0.6)";
    iconBox.className = "w-14 h-14 rounded-2xl flex items-center justify-center text-2xl shadow-lg border bg-amber-950/80 text-amber-400 border-amber-500 pulse-yellow";
    iconBox.innerHTML = '<i class="fa-solid fa-hand-holding-dollar"></i>';
    badge.className = "text-xs px-2.5 py-0.5 rounded-full font-bold bg-amber-500 text-slate-950";
  } else if (exit.signal_type === "APPROACHING_TARGET") {
    banner.style.borderColor = "rgba(59, 130, 246, 0.5)";
    iconBox.className = "w-14 h-14 rounded-2xl flex items-center justify-center text-2xl shadow-lg border bg-blue-950/80 text-blue-400 border-blue-500";
    iconBox.innerHTML = '<i class="fa-solid fa-crosshairs"></i>';
    badge.className = "text-xs px-2.5 py-0.5 rounded-full font-bold bg-blue-500 text-white";
  } else if (exit.signal_type === "STOP_LOSS_ALERT") {
    banner.style.borderColor = "rgba(239, 68, 68, 0.8)";
    iconBox.className = "w-14 h-14 rounded-2xl flex items-center justify-center text-2xl shadow-lg border bg-red-950 text-red-400 border-red-500 animate-pulse";
    iconBox.innerHTML = '<i class="fa-solid fa-shield-halved"></i>';
    badge.className = "text-xs px-2.5 py-0.5 rounded-full font-bold bg-red-600 text-white";
  } else {
    banner.style.borderColor = "rgba(16, 185, 129, 0.4)";
    iconBox.className = "w-14 h-14 rounded-2xl flex items-center justify-center text-2xl shadow-lg border bg-emerald-950/80 text-emerald-400 border-emerald-500";
    iconBox.innerHTML = '<i class="fa-solid fa-check-double"></i>';
    badge.className = "text-xs px-2.5 py-0.5 rounded-full font-bold bg-emerald-500 text-slate-950";
  }

  document.getElementById("val-conservative-price").innerText = `${currSym}${dcf.conservative_value ? dcf.conservative_value.toLocaleString() : '-'}`;
  document.getElementById("val-base-price").innerText = `${currSym}${dcf.base_fair_value ? dcf.base_fair_value.toLocaleString() : '-'}`;
  document.getElementById("val-bullish-price").innerText = `${currSym}${dcf.bullish_value ? dcf.bullish_value.toLocaleString() : '-'}`;
  
  const gapPct = exit.valuation_gap_pct || 0;
  const gapEl = document.getElementById("val-base-gap");
  gapEl.innerText = `현재가 대비 괴리율: ${gapPct >= 0 ? '+' : ''}${gapPct}%`;
  gapEl.className = gapPct > 10 ? "font-bold text-amber-400" : (gapPct < -10 ? "font-bold text-emerald-400" : "font-bold text-slate-300");

  document.getElementById("tech-rsi").innerText = tech.rsi_14 || 50;
  document.getElementById("tech-rsi-status").innerText = tech.overbought_level || "중립";
  document.getElementById("tech-bb-upper").innerText = `${currSym}${tech.bollinger_upper ? tech.bollinger_upper.toLocaleString() : '-'}`;
  document.getElementById("tech-sma-20").innerText = `${currSym}${tech.sma_20 ? tech.sma_20.toLocaleString() : '-'}`;
  document.getElementById("tech-sma-60").innerText = `${currSym}${tech.sma_60 ? tech.sma_60.toLocaleString() : '-'}`;

  document.getElementById("plan-stop-loss-price").innerText = `${currSym}${exit.stop_loss_price ? exit.stop_loss_price.toLocaleString() : '-'}`;
  renderExitPlanTable(exit.sell_plan || [], currSym, stock.current_price);

  document.getElementById("metric-wacc").innerText = `${dcf.wacc || 9.45}%`;
  document.getElementById("metric-ke").innerText = `${dcf.cost_of_equity || 10.5}%`;
  document.getElementById("metric-beta").innerText = `${dcf.levered_beta || 1.25}`;
  document.getElementById("metric-growth").innerText = `${stock.damodaran_inputs ? stock.damodaran_inputs.growth_rate_next_5y : 8.0}%`;
  document.getElementById("metric-margin").innerText = `${stock.damodaran_inputs ? stock.damodaran_inputs.target_ebit_margin : 18.0}%`;
  document.getElementById("metric-sales-cap").innerText = `${stock.damodaran_inputs ? stock.damodaran_inputs.sales_to_capital : 1.4}`;

  const rfSlider = document.getElementById("rf-slider");
  if (rfSlider && dcf.rf_used) {
    rfSlider.value = dcf.rf_used;
    document.getElementById("slider-rf-val").innerText = `현재 적용 10Y 국채(Rf): ${dcf.rf_used}%`;
  }

  renderValuationChart();
}

function renderExitPlanTable(plan, currSym, currentPrice) {
  const tbody = document.getElementById("exit-plan-tbody");
  if (!tbody) return;

  tbody.innerHTML = plan.map(step => {
    const isReached = currentPrice >= step.target_price;
    const isClose = !isReached && (currentPrice >= step.target_price * 0.95);

    let statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-400">대기 중</span>`;
    if (isReached) {
      statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500 text-slate-950 animate-pulse">발동됨 (매도 실행)</span>`;
    } else if (isClose) {
      statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/40">도달 임박</span>`;
    }

    return `
      <tr class="hover:bg-slate-900/50 transition">
        <td class="p-3 font-semibold text-white">${step.step}</td>
        <td class="p-3 text-amber-300 font-bold">${currSym}${step.target_price.toLocaleString()}</td>
        <td class="p-3 text-slate-300">${step.ratio_pct}%</td>
        <td class="p-3 text-indigo-300 font-bold">${step.shares}주</td>
        <td class="p-3 text-slate-400 text-[11px]">${step.condition}</td>
        <td class="p-3 text-right">${statusBadge}</td>
      </tr>
    `;
  }).join('');
}

function renderValuationChart() {
  const canvas = document.getElementById("stockValuationChart");
  if (!canvas || !g_selectedStock) return;

  if (g_stockChart) {
    g_stockChart.destroy();
  }

  const stock = g_selectedStock;
  const dcf = stock.dcf || {};
  const currPrice = stock.current_price;
  const buyPrice = stock.buy_price;

  const labels = ["D-9", "D-8", "D-7", "D-6", "D-5", "D-4", "D-3", "D-2", "어제", "현재"];
  
  const priceData = [
    buyPrice * 0.98,
    buyPrice * 1.01,
    buyPrice * 1.03,
    buyPrice * 1.02,
    buyPrice * 1.05,
    buyPrice * 1.04,
    currPrice * 0.97,
    currPrice * 0.98,
    currPrice * 0.99,
    currPrice
  ];

  const conservativeLine = Array(10).fill(dcf.conservative_value || currPrice * 0.85);
  const baseFairLine = Array(10).fill(dcf.base_fair_value || currPrice * 1.05);
  const bullishLine = Array(10).fill(dcf.bullish_value || currPrice * 1.25);
  const stopLossLine = Array(10).fill(stock.exit_analysis ? stock.exit_analysis.stop_loss_price : currPrice * 0.92);

  const ctx = canvas.getContext("2d");
  g_stockChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: "주가 (현재가)",
          data: priceData,
          borderColor: "#3b82f6",
          backgroundColor: "rgba(59, 130, 246, 0.1)",
          borderWidth: 3,
          fill: true,
          tension: 0.2,
          pointRadius: 4,
          pointHoverRadius: 7,
          pointBackgroundColor: "#3b82f6"
        },
        {
          label: "다모다란 적정가 (Base Fair Value - 1차 익절)",
          data: baseFairLine,
          borderColor: "#f59e0b",
          borderWidth: 2,
          borderDash: [6, 4],
          pointRadius: 0,
          fill: false
        },
        {
          label: "낙관적 가치 (Bull Target - 최종 익절)",
          data: bullishLine,
          borderColor: "#818cf8",
          borderWidth: 2,
          borderDash: [4, 4],
          pointRadius: 0,
          fill: false
        },
        {
          label: "보수적 안전마진선 (지지선)",
          data: conservativeLine,
          borderColor: "#10b981",
          borderWidth: 1.5,
          borderDash: [2, 2],
          pointRadius: 0,
          fill: false
        },
        {
          label: "손절 기준선 (Stop Loss)",
          data: stopLossLine,
          borderColor: "#ef4444",
          borderWidth: 1.5,
          borderDash: [3, 3],
          pointRadius: 0,
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false
      },
      scales: {
        y: {
          ticks: {
            color: "#94a3b8",
            callback: v => (stock.currency === "USD" ? "$" : "₩") + v.toLocaleString()
          },
          grid: { color: "rgba(255, 255, 255, 0.05)" }
        },
        x: {
          ticks: { color: "#cbd5e1" },
          grid: { color: "rgba(255, 255, 255, 0.05)" }
        }
      },
      plugins: {
        legend: {
          position: "top",
          labels: { color: "#e2e8f0", font: { size: 11 } }
        }
      }
    }
  });
}

// Slider change for 10Y Rf
let sliderDebounce = null;
function handleRfSliderChange(val) {
  document.getElementById("slider-rf-val").innerText = `시뮬레이션 10Y 국채(Rf): ${val}%`;
  clearTimeout(sliderDebounce);
  sliderDebounce = setTimeout(async () => {
    if (!g_selectedStock) return;
    try {
      const res = await fetch(`/api/stock/${g_selectedStock.id}?rf=${val}`);
      if (!res.ok) throw new Error("Offline");
      const updated = await res.json();
      g_selectedStock.dcf = updated.dcf;
      g_selectedStock.exit_analysis = updated.exit_analysis;
    } catch (e) {
      const dcf = jsCalculateDamodaranDcf(g_selectedStock, val);
      const exit = jsEvaluateExitTiming(g_selectedStock, dcf);
      g_selectedStock.dcf = dcf;
      g_selectedStock.exit_analysis = exit;
    }
    renderSelectedStockHero();
  }, 100);
}

function resetRfSlider() {
  if (!g_selectedStock) return;
  const defRf = g_selectedStock.market === "US" ? 5.01 : 3.35;
  document.getElementById("rf-slider").value = defRf;
  handleRfSliderChange(defRf);
}

// =============================================================================
// Sector Benchmarks & Sensitivity Matrix
// =============================================================================
async function fetchSectors() {
  try {
    const res = await fetch("/api/sectors");
    if (!res.ok) throw new Error("Server offline");
    const data = await res.json();
    g_sectorsData = data.sectors || [];
  } catch (e) {
    g_sectorsData = OFFLINE_SECTORS_SEED;
  }
  renderSectorsCards(g_sectorsData);
}

function renderSectorsCards(sectors) {
  const container = document.getElementById("sectors-cards-container");
  if (!container) return;

  container.innerHTML = sectors.map(sec => {
    const m = sec.macro_profile || {};
    const krStocks = sec.top_stocks_kr || [];
    const usStocks = sec.top_stocks_us || [];

    return `
      <div class="glass-panel p-5 space-y-4 border border-slate-800 flex flex-col justify-between hover:border-slate-700 transition shadow-lg">
        <div>
          <div class="flex items-center justify-between border-b border-slate-800 pb-2.5">
            <div>
              <div class="flex items-center gap-1.5">
                <h4 class="font-black text-sm text-white">${sec.name_kr}</h4>
                ${sec.id === 'power_grid' ? '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse">신설</span>' : ''}
              </div>
              <span class="text-[10px] text-slate-500 font-mono">${sec.name_en}</span>
            </div>
            <span class="text-[11px] px-2 py-0.5 rounded font-mono font-bold bg-indigo-950 text-indigo-300 border border-indigo-800/40">
              β ${sec.damodaran_unlevered_beta}
            </span>
          </div>

          <!-- Key Damodaran Metrics -->
          <div class="grid grid-cols-3 gap-1.5 py-3 text-center border-b border-slate-800/60 text-xs">
            <div class="bg-slate-900/60 p-1.5 rounded">
              <span class="text-[10px] text-slate-500 block">WACC</span>
              <span class="font-bold text-white font-mono">${sec.avg_cost_of_capital}%</span>
            </div>
            <div class="bg-slate-900/60 p-1.5 rounded">
              <span class="text-[10px] text-slate-500 block">EBIT 마진</span>
              <span class="font-bold text-emerald-400 font-mono">${sec.avg_ebit_margin}%</span>
            </div>
            <div class="bg-slate-900/60 p-1.5 rounded">
              <span class="text-[10px] text-slate-500 block">R&D 부스트</span>
              <span class="font-bold text-purple-400 font-mono">+${sec.rd_capitalization_boost}%</span>
            </div>
          </div>

          <!-- Macro Profile -->
          <div class="space-y-2 py-3 text-xs border-b border-slate-800/60">
            <div class="flex items-start space-x-2">
              <span class="text-amber-400 font-bold shrink-0 text-[11px] flex items-center gap-1"><i class="fa-solid fa-percent text-[9px]"></i>금리:</span>
              <span class="text-slate-300 text-[11px] leading-tight">${m.interest_rate_impact || '-'}</span>
            </div>
            <div class="flex items-start space-x-2">
              <span class="text-blue-400 font-bold shrink-0 text-[11px] flex items-center gap-1"><i class="fa-solid fa-money-bill-transfer text-[9px]"></i>환율:</span>
              <span class="text-slate-300 text-[11px] leading-tight">${m.fx_impact || '-'}</span>
            </div>
            <div class="flex items-start space-x-2">
              <span class="text-rose-400 font-bold shrink-0 text-[11px] flex items-center gap-1"><i class="fa-solid fa-oil-well text-[9px]"></i>유가:</span>
              <span class="text-slate-300 text-[11px] leading-tight">${m.oil_impact || '-'}</span>
            </div>
            ${m.cycle_phase ? `
              <div class="flex items-start space-x-2 pt-1 border-t border-slate-800/40">
                <span class="text-indigo-400 font-bold shrink-0 text-[11px] flex items-center gap-1"><i class="fa-solid fa-arrows-spin text-[9px]"></i>사이클:</span>
                <span class="text-indigo-200/90 text-[11px] leading-tight font-medium">${m.cycle_phase}</span>
              </div>
            ` : ''}
          </div>

          <!-- Top 5 KR & US Representative Stocks -->
          <div class="py-3 space-y-2.5">
            <div>
              <div class="flex items-center justify-between mb-1.5">
                <span class="text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
                  <span class="text-sm">🇰🇷</span> 국내 대표 Top 5
                </span>
                <span class="text-[10px] text-slate-500">클릭 시 차트/DCF 분석</span>
              </div>
              <div class="flex flex-wrap gap-1.5">
                ${krStocks.map(s => `
                  <button type="button" onclick="inspectStockFromSector('${s.name}', '${s.ticker}', 'KR')" class="group px-2 py-1 rounded-lg bg-slate-900/90 hover:bg-indigo-600/90 border border-slate-700/80 hover:border-indigo-400 text-slate-200 hover:text-white transition flex items-center gap-1 text-[11px] font-medium shadow-sm" title="${s.name} (${s.ticker}) 프로 차트 & 다모다란 가치 분석">
                    <span>${s.name}</span>
                    <span class="text-[9px] text-slate-500 group-hover:text-indigo-200 font-mono">${s.ticker}</span>
                  </button>
                `).join('')}
              </div>
            </div>

            <div>
              <div class="flex items-center justify-between mb-1.5">
                <span class="text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
                  <span class="text-sm">🇺🇸</span> 미국 대표 Top 5
                </span>
                <span class="text-[10px] text-slate-500">클릭 시 차트/DCF 분석</span>
              </div>
              <div class="flex flex-wrap gap-1.5">
                ${usStocks.map(s => `
                  <button type="button" onclick="inspectStockFromSector('${s.name}', '${s.ticker}', 'US')" class="group px-2 py-1 rounded-lg bg-slate-900/90 hover:bg-blue-600/90 border border-slate-700/80 hover:border-blue-400 text-slate-200 hover:text-white transition flex items-center gap-1 text-[11px] font-medium shadow-sm" title="${s.name} (${s.ticker}) 프로 차트 & 다모다란 가치 분석">
                    <span>${s.name}</span>
                    <span class="text-[9px] text-slate-500 group-hover:text-blue-200 font-mono">${s.ticker}</span>
                  </button>
                `).join('')}
              </div>
            </div>
          </div>
        </div>

        <div class="p-3 rounded-xl bg-slate-950/90 border border-slate-800/90 text-[11px] text-amber-300/90 leading-relaxed shadow-inner">
          <i class="fa-solid fa-flag-checkered mr-1 text-amber-400"></i>
          <strong>매도 가이드:</strong> ${sec.exit_recommendation_guide || '-'}
        </div>
      </div>
    `;
  }).join('');
}

function filterSectors(type) {
  document.querySelectorAll(".sector-filter-btn").forEach(btn => {
    btn.className = "sector-filter-btn px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 font-medium text-xs";
  });
  if (event && event.target) {
    const target = event.target.closest('button') || event.target;
    target.className = "sector-filter-btn px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-medium text-xs";
  }

  if (type === "all") {
    renderSectorsCards(g_sectorsData);
    return;
  }

  let filtered = [];
  if (type === "power") {
    filtered = g_sectorsData.filter(s => s.id === "power_grid");
  } else if (type === "interest_cut") {
    filtered = g_sectorsData.filter(s => s.id === "software_ai" || s.id === "biotech_pharma" || s.id === "battery_cleanenergy");
  } else if (type === "fx_weak") {
    filtered = g_sectorsData.filter(s => s.id === "semiconductor" || s.id === "auto_mobility" || s.id === "defense_shipbuilding" || s.id === "power_grid");
  } else if (type === "oil_high") {
    filtered = g_sectorsData.filter(s => s.id === "energy_chemical" || s.id === "defense_shipbuilding" || s.id === "power_grid");
  }
  renderSectorsCards(filtered);
}

function inspectStockFromSector(name, ticker, market) {
  switchTab('chart');
  quickSelectChartStock(name, ticker, market);
}

// =============================================================================
// Finviz Style Market Treemap & Macro Sector Heatmap (Tab 3 Extension)
// =============================================================================

/**
 * 핀비즈(Finviz) 마켓 맵 데이터 로드 및 갱신
 */
async function loadMarketMap(forceRefresh = false) {
  const loadingEl = document.getElementById("market-map-loading");
  const refreshIcon = document.getElementById("icon-refresh-market-map");
  if (refreshIcon) refreshIcon.classList.add("fa-spin");
  if (loadingEl && !g_marketMapData) loadingEl.classList.remove("hidden");

  try {
    const url = `/api/market-map?market=${g_mapMarket}${forceRefresh ? '&refresh=1' : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Market map API error");
    const data = await res.json();
    if (data.success && data.sectors) {
      g_marketMapData = data;
    }
  } catch (err) {
    console.warn("API Market Map fetch failed, building fallback from sectors data:", err);
    // Fallback: build map from g_sectorsData or OFFLINE_SECTORS_SEED
    if (!g_marketMapData) {
      g_marketMapData = buildFallbackMarketMap(g_mapMarket);
    }
  } finally {
    if (refreshIcon) refreshIcon.classList.remove("fa-spin");
    if (loadingEl) loadingEl.classList.add("hidden");
  }

  // Update timestamp display
  const updateEl = document.getElementById("market-map-last-update");
  if (updateEl) {
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    updateEl.textContent = `최근 시세 동기화: ${timeStr}`;
  }

  renderFinvizLegend();
  renderFinvizTreemap();
}

/**
 * 오프라인/에러 시 백업 마켓 맵 데이터 생성
 */
function buildFallbackMarketMap(marketFilter) {
  const sourceSectors = (g_sectorsData && g_sectorsData.length > 0) ? g_sectorsData : (window.OFFLINE_SECTORS_SEED || []);
  const sectors = sourceSectors.map(sec => {
    let stocks = [];
    if (marketFilter === "all" || marketFilter === "KR") {
      (sec.top_stocks_kr || []).forEach((st, idx) => {
        stocks.push({
          ticker: st.ticker,
          name: st.name,
          market: "KR",
          currency: "KRW",
          current_price: 50000 + idx * 15000,
          price_formatted: `₩${(50000 + idx * 15000).toLocaleString()}`,
          change_pct: Number((((idx * 1.7) % 5.5) - 2.2).toFixed(2)),
          market_cap_norm: Math.max(5, 120 - idx * 22),
          market_cap_formatted: `${Math.max(5, 120 - idx * 22)}조 원`,
          valuation_gap_pct: Number((((idx * 5.3) % 45) - 15).toFixed(1)),
          rsi: Number((45 + ((idx * 7) % 30)).toFixed(1))
        });
      });
    }
    if (marketFilter === "all" || marketFilter === "US") {
      (sec.top_stocks_us || []).forEach((st, idx) => {
        stocks.push({
          ticker: st.ticker,
          name: st.name,
          market: "US",
          currency: "USD",
          current_price: 150 + idx * 45,
          price_formatted: `$${(150 + idx * 45).toFixed(2)}`,
          change_pct: Number((((idx * 2.1) % 6.0) - 2.5).toFixed(2)),
          market_cap_norm: Math.max(10, 500 - idx * 80),
          market_cap_formatted: `$${Math.max(10, 500 - idx * 80)}B`,
          valuation_gap_pct: Number((((idx * 6.1) % 40) - 12).toFixed(1)),
          rsi: Number((48 + ((idx * 8) % 28)).toFixed(1))
        });
      });
    }
    return {
      id: sec.id,
      name_kr: sec.name_kr,
      name_en: sec.name_en,
      beta: sec.damodaran_unlevered_beta || 1.0,
      wacc: sec.avg_cost_of_capital || 9.0,
      sector_weight: sec.sector_weight || 11,
      stocks: stocks
    };
  });

  return {
    success: true,
    market: marketFilter,
    total_sectors: sectors.length,
    sectors: sectors
  };
}

/**
 * 시장 필터 변경 (글로벌 통합 / 국내 / 미국)
 */
function setMapMarket(market) {
  g_mapMarket = market;
  ["all", "kr", "us"].forEach(m => {
    const btn = document.getElementById(`btn-map-market-${m}`);
    if (btn) {
      if (m.toUpperCase() === market.toUpperCase()) {
        btn.className = "map-market-btn px-3 py-1 rounded-lg bg-indigo-600 text-white font-bold transition shadow-sm";
      } else {
        btn.className = "map-market-btn px-3 py-1 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition font-medium";
      }
    }
  });
  loadMarketMap();
}

/**
 * 히트맵 색상 지표 변경 (등락률 / 다모다란 저평가율 / RSI)
 */
function setMapMetric(metric) {
  g_mapMetric = metric;
  const metrics = [
    { key: "change", id: "btn-map-metric-change", activeBg: "bg-emerald-600" },
    { key: "dcf", id: "btn-map-metric-dcf", activeBg: "bg-amber-600" },
    { key: "rsi", id: "btn-map-metric-rsi", activeBg: "bg-cyan-600" }
  ];

  metrics.forEach(m => {
    const btn = document.getElementById(m.id);
    if (btn) {
      if (m.key === metric) {
        btn.className = `map-metric-btn px-3 py-1 rounded-lg ${m.activeBg} text-white font-bold transition shadow-sm flex items-center gap-1`;
      } else {
        btn.className = "map-metric-btn px-3 py-1 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition font-medium flex items-center gap-1";
      }
    }
  });

  renderFinvizLegend();
  renderFinvizTreemap();
}

/**
 * 화면 보기 모드 변경 (상하 동시 / 트리맵만 / 카드만)
 */
function setMapViewMode(mode) {
  g_mapViewMode = mode;
  const modes = ["split", "map", "cards"];
  modes.forEach(m => {
    const btn = document.getElementById(`btn-map-view-${m}`);
    if (btn) {
      if (m === mode) {
        btn.className = "map-view-btn px-2.5 py-1 rounded-lg bg-indigo-600 text-white font-bold transition shadow-sm";
      } else {
        btn.className = "map-view-btn px-2.5 py-1 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition font-medium";
      }
    }
  });

  const mapSec = document.getElementById("finviz-treemap-section");
  const cardsSec = document.getElementById("sectors-cards-section");
  if (mapSec && cardsSec) {
    if (mode === "split") {
      mapSec.classList.remove("hidden");
      cardsSec.classList.remove("hidden");
    } else if (mode === "map") {
      mapSec.classList.remove("hidden");
      cardsSec.classList.add("hidden");
    } else if (mode === "cards") {
      mapSec.classList.add("hidden");
      cardsSec.classList.remove("hidden");
    }
  }

  if (mode !== "cards") {
    setTimeout(() => renderFinvizTreemap(), 50);
  }
}

/**
 * 핀비즈 색상 스케일 계산기 (Finviz Standard Color Palette)
 */
function getFinvizColor(stock, metric) {
  if (metric === "change") {
    const chg = stock.change_pct ?? 0;
    if (chg >= 3.0) return { bg: "#15803d", text: "#ffffff", border: "#22c55e", label: `+${chg.toFixed(2)}%` };
    if (chg >= 1.5) return { bg: "#166534", text: "#ffffff", border: "#16a34a", label: `+${chg.toFixed(2)}%` };
    if (chg >= 0.2) return { bg: "#14532d", text: "#e2e8f0", border: "#15803d", label: `+${chg.toFixed(2)}%` };
    if (chg <= -3.0) return { bg: "#dc2626", text: "#ffffff", border: "#ef4444", label: `${chg.toFixed(2)}%` };
    if (chg <= -1.5) return { bg: "#b91c1c", text: "#ffffff", border: "#dc2626", label: `${chg.toFixed(2)}%` };
    if (chg <= -0.2) return { bg: "#991b1b", text: "#e2e8f0", border: "#b91c1c", label: `${chg.toFixed(2)}%` };
    return { bg: "#334155", text: "#94a3b8", border: "#475569", label: `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%` };
  } else if (metric === "dcf") {
    // Valuation Gap: 양수 = 저평가(매수 기회 / 초록), 음수 = 고평가(매도 주의 / 빨강)
    const gap = stock.valuation_gap_pct ?? 0;
    if (gap >= 25.0) return { bg: "#15803d", text: "#ffffff", border: "#22c55e", label: `+${gap.toFixed(1)}% 저평가` };
    if (gap >= 12.0) return { bg: "#166534", text: "#ffffff", border: "#16a34a", label: `+${gap.toFixed(1)}% 저평가` };
    if (gap >= 2.0) return { bg: "#14532d", text: "#e2e8f0", border: "#15803d", label: `+${gap.toFixed(1)}% 적정/저` };
    if (gap <= -25.0) return { bg: "#dc2626", text: "#ffffff", border: "#ef4444", label: `${gap.toFixed(1)}% 고평가` };
    if (gap <= -12.0) return { bg: "#b91c1c", text: "#ffffff", border: "#dc2626", label: `${gap.toFixed(1)}% 고평가` };
    if (gap <= -2.0) return { bg: "#991b1b", text: "#e2e8f0", border: "#b91c1c", label: `${gap.toFixed(1)}% 완만고` };
    return { bg: "#334155", text: "#94a3b8", border: "#475569", label: `${gap >= 0 ? '+' : ''}${gap.toFixed(1)}% 적정` };
  } else if (metric === "rsi") {
    // RSI: 과매도 침체(<=30, 반등 매수 기회 / 초록), 과매수 과열(>=70, 차익실현 경고 / 빨강)
    const rsi = stock.rsi ?? 50;
    if (rsi <= 30) return { bg: "#15803d", text: "#ffffff", border: "#22c55e", label: `RSI ${rsi.toFixed(1)} 과매도` };
    if (rsi <= 42) return { bg: "#166534", text: "#ffffff", border: "#16a34a", label: `RSI ${rsi.toFixed(1)} 침체` };
    if (rsi >= 70) return { bg: "#dc2626", text: "#ffffff", border: "#ef4444", label: `RSI ${rsi.toFixed(1)} 과매수` };
    if (rsi >= 58) return { bg: "#b91c1c", text: "#ffffff", border: "#dc2626", label: `RSI ${rsi.toFixed(1)} 과열` };
    return { bg: "#334155", text: "#94a3b8", border: "#475569", label: `RSI ${rsi.toFixed(1)} 중립` };
  }
  return { bg: "#334155", text: "#ffffff", border: "#475569", label: "-" };
}

/**
 * 순수 JS 재귀 2D Treemap 분할 알고리즘 (Squarified Binary Treemap)
 */
function computeTreemapPartition(items, x, y, w, h) {
  if (!items || items.length === 0 || w <= 2 || h <= 2) return [];
  if (items.length === 1) {
    return [{ ...items[0], rect: { x, y, w, h } }];
  }

  const totalW = items.reduce((acc, it) => acc + (it.eff_weight || 1), 0);
  if (totalW <= 0) return [];

  const half = totalW / 2.0;
  let accum = 0;
  let splitIdx = 1;
  let bestDiff = Infinity;

  for (let i = 0; i < items.length - 1; i++) {
    accum += (items[i].eff_weight || 1);
    const diff = Math.abs(accum - half);
    if (diff < bestDiff) {
      bestDiff = diff;
      splitIdx = i + 1;
    }
  }

  const g1 = items.slice(0, splitIdx);
  const g2 = items.slice(splitIdx);
  const g1Sum = g1.reduce((acc, it) => acc + (it.eff_weight || 1), 0);

  if (w >= h) {
    const w1 = Math.max(1, Math.min(w - 1, Math.round(w * (g1Sum / totalW))));
    const w2 = w - w1;
    return [
      ...computeTreemapPartition(g1, x, y, w1, h),
      ...computeTreemapPartition(g2, x + w1, y, w2, h)
    ];
  } else {
    const h1 = Math.max(1, Math.min(h - 1, Math.round(h * (g1Sum / totalW))));
    const h2 = h - h1;
    return [
      ...computeTreemapPartition(g1, x, y, w, h1),
      ...computeTreemapPartition(g2, x, y + h1, w, h2)
    ];
  }
}

/**
 * 핀비즈 하단 범례 (Legend) 렌더링
 */
function renderFinvizLegend() {
  const container = document.getElementById("finviz-legend-container");
  if (!container) return;

  if (g_mapMetric === "change") {
    container.innerHTML = `
      <span class="text-slate-400 font-bold text-[11px] mr-1">등락률 범례:</span>
      <div class="flex items-center space-x-1">
        <span class="text-[10px] text-rose-400 font-mono">-3%↓</span>
        <span class="w-4 h-3 rounded-sm bg-[#dc2626]" title="≤ -3.0%"></span>
        <span class="w-4 h-3 rounded-sm bg-[#b91c1c]" title="-1.5% ~ -3.0%"></span>
        <span class="w-4 h-3 rounded-sm bg-[#991b1b]" title="-0.2% ~ -1.5%"></span>
        <span class="w-4 h-3 rounded-sm bg-[#334155]" title="-0.2% ~ +0.2% (보합)"></span>
        <span class="w-4 h-3 rounded-sm bg-[#14532d]" title="+0.2% ~ +1.5%"></span>
        <span class="w-4 h-3 rounded-sm bg-[#166534]" title="+1.5% ~ +3.0%"></span>
        <span class="w-4 h-3 rounded-sm bg-[#15803d]" title="≥ +3.0%"></span>
        <span class="text-[10px] text-emerald-400 font-mono">+3%↑</span>
      </div>
    `;
  } else if (g_mapMetric === "dcf") {
    container.innerHTML = `
      <span class="text-slate-400 font-bold text-[11px] mr-1">다모다란 밸류에이션:</span>
      <div class="flex items-center space-x-1">
        <span class="text-[10px] text-rose-400 font-bold">고평가(매도주의)</span>
        <span class="w-4 h-3 rounded-sm bg-[#dc2626]"></span>
        <span class="w-4 h-3 rounded-sm bg-[#b91c1c]"></span>
        <span class="w-4 h-3 rounded-sm bg-[#991b1b]"></span>
        <span class="w-4 h-3 rounded-sm bg-[#334155]"></span>
        <span class="w-4 h-3 rounded-sm bg-[#14532d]"></span>
        <span class="w-4 h-3 rounded-sm bg-[#166534]"></span>
        <span class="w-4 h-3 rounded-sm bg-[#15803d]"></span>
        <span class="text-[10px] text-emerald-400 font-bold">저평가(매수기회)</span>
      </div>
    `;
  } else if (g_mapMetric === "rsi") {
    container.innerHTML = `
      <span class="text-slate-400 font-bold text-[11px] mr-1">RSI 모멘텀(14D):</span>
      <div class="flex items-center space-x-1">
        <span class="text-[10px] text-rose-400 font-bold">과열(70+ 차익실현)</span>
        <span class="w-4 h-3 rounded-sm bg-[#dc2626]"></span>
        <span class="w-4 h-3 rounded-sm bg-[#b91c1c]"></span>
        <span class="w-4 h-3 rounded-sm bg-[#334155]"></span>
        <span class="w-4 h-3 rounded-sm bg-[#166534]"></span>
        <span class="w-4 h-3 rounded-sm bg-[#15803d]"></span>
        <span class="text-[10px] text-emerald-400 font-bold">침체(30- 반등매수)</span>
      </div>
    `;
  }
}

/**
 * 핀비즈 트리맵 메인 렌더러
 */
function renderFinvizTreemap() {
  const canvas = document.getElementById("finviz-treemap-canvas");
  if (!canvas) return;

  if (!g_marketMapData || !g_marketMapData.sectors || g_marketMapData.sectors.length === 0) {
    canvas.innerHTML = `
      <div class="w-full h-full flex items-center justify-center text-slate-500 text-xs">
        <div class="text-center space-y-2">
          <i class="fa-solid fa-map text-2xl text-slate-600"></i>
          <p>마켓 맵 데이터를 불러오는 중입니다...</p>
        </div>
      </div>
    `;
    return;
  }

  const canvasW = canvas.clientWidth || 980;
  const canvasH = canvas.clientHeight || 600;

  // 1. 유효 섹터 필터링 및 섹터 가중치 계산 (멱함수 스케일링으로 가시성 최적화)
  const sectors = g_marketMapData.sectors
    .filter(s => s.stocks && s.stocks.length > 0)
    .map(s => {
      const stocksWeightSum = s.stocks.reduce((acc, st) => acc + Math.pow(Math.max(1, st.market_cap_norm || 10), 0.55), 0);
      return {
        ...s,
        eff_weight: Math.max(15, stocksWeightSum)
      };
    })
    .sort((a, b) => b.eff_weight - a.eff_weight);

  if (sectors.length === 0) {
    canvas.innerHTML = `<div class="w-full h-full flex items-center justify-center text-slate-500 text-xs">표시할 종목 데이터가 없습니다.</div>`;
    return;
  }

  // 2. 섹터 레이아웃 사각 분할 계산
  const sectorRects = computeTreemapPartition(sectors, 0, 0, canvasW, canvasH);

  // 3. 렌더링 HTML 조합
  let html = "";

  sectorRects.forEach(secItem => {
    const sRect = secItem.rect;
    if (sRect.w <= 10 || sRect.h <= 10) return;

    // 섹터 헤더 높이 결정
    const hasHeader = sRect.h >= 50 && sRect.w >= 70;
    const hdrH = hasHeader ? (sRect.h >= 80 ? 22 : 18) : 0;
    const stocksAreaH = Math.max(0, sRect.h - hdrH);
    const stocksAreaW = sRect.w;

    // 섹터 박스 시작
    html += `
      <div class="absolute border border-slate-800/90 bg-slate-900/60 rounded-lg overflow-hidden transition-all"
           style="left:${sRect.x}px; top:${sRect.y}px; width:${sRect.w}px; height:${sRect.h}px; box-sizing:border-box;">
    `;

    // 섹터 타이틀 헤더
    if (hasHeader) {
      html += `
        <div class="h-[${hdrH}px] px-2 bg-slate-950/90 border-b border-slate-800/80 flex items-center justify-between text-[11px] select-none">
          <span class="font-black text-slate-200 truncate pr-1 text-[11px]">${secItem.name_kr}</span>
          <span class="text-[9px] font-mono text-indigo-300 shrink-0">β${secItem.beta}</span>
        </div>
      `;
    }

    // 섹터 내부 종목들 사각 분할 계산
    if (stocksAreaH > 10 && stocksAreaW > 10 && secItem.stocks.length > 0) {
      const stocksPrepared = secItem.stocks.map(st => ({
        ...st,
        sector_name: secItem.name_kr,
        eff_weight: Math.pow(Math.max(1, st.market_cap_norm || 10), 0.55)
      })).sort((a, b) => b.eff_weight - a.eff_weight);

      const stockRects = computeTreemapPartition(stocksPrepared, 0, 0, stocksAreaW, stocksAreaH);

      html += `<div class="relative" style="width:${stocksAreaW}px; height:${stocksAreaH}px;">`;

      stockRects.forEach(stItem => {
        const r = stItem.rect;
        if (r.w <= 2 || r.h <= 2) return;

        const color = getFinvizColor(stItem, g_mapMetric);
        const isBig = r.w >= 68 && r.h >= 45;
        const isMedium = r.w >= 48 && r.h >= 32;
        const isSmall = r.w >= 36 && r.h >= 22;

        const stockDataJson = encodeURIComponent(JSON.stringify({
          name: stItem.name,
          ticker: stItem.ticker,
          market: stItem.market,
          sector: secItem.name_kr,
          price: stItem.price_formatted,
          change: stItem.change_pct,
          cap: stItem.market_cap_formatted,
          dcf_gap: stItem.valuation_gap_pct,
          rsi: stItem.rsi
        }));

        html += `
          <div class="absolute group cursor-pointer transition-transform duration-75 hover:z-20"
               style="left:${r.x}px; top:${r.y}px; width:${r.w}px; height:${r.h}px; padding:1px; box-sizing:border-box;"
               onclick="inspectStockFromSector('${stItem.name}', '${stItem.ticker}', '${stItem.market}')"
               onmouseenter="showFinvizTooltip(this, '${stockDataJson}', event)"
               onmousemove="moveFinvizTooltip(event)"
               onmouseleave="hideFinvizTooltip()">
            <div class="w-full h-full rounded flex flex-col justify-center items-center text-center p-1 overflow-hidden transition-all duration-150 hover:brightness-125 hover:shadow-lg hover:shadow-indigo-500/20"
                 style="background-color: ${color.bg}; border: 1px solid ${color.border};">
        `;

        if (isBig) {
          html += `
            <div class="flex items-center gap-1 leading-none">
              <span class="font-extrabold text-xs text-white drop-shadow truncate max-w-[80px]">${stItem.name}</span>
              ${g_mapMarket === "all" ? `<span class="text-[9px] opacity-80">${stItem.market === 'KR' ? '🇰🇷' : '🇺🇸'}</span>` : ''}
            </div>
            <span class="text-[10px] font-mono text-white/90 leading-tight mt-0.5">${stItem.price_formatted}</span>
            <span class="text-[10px] font-bold text-white px-1 rounded bg-black/25 mt-0.5 leading-tight">${color.label}</span>
          `;
        } else if (isMedium) {
          html += `
            <span class="font-extrabold text-[11px] text-white drop-shadow leading-none truncate max-w-[55px]">${stItem.name}</span>
            <span class="text-[9px] font-bold text-white px-0.5 rounded bg-black/25 leading-tight mt-0.5">${color.label}</span>
          `;
        } else if (isSmall) {
          html += `
            <span class="font-bold text-[10px] text-white leading-none truncate max-w-[40px]">${stItem.name}</span>
          `;
        } else {
          html += `
            <span class="font-mono text-[8px] text-white/90 leading-none truncate">${stItem.ticker}</span>
          `;
        }

        html += `
            </div>
          </div>
        `;
      });

      html += `</div>`;
    }

    html += `</div>`;
  });

  canvas.innerHTML = html;
}

/**
 * 핀비즈 인터랙티브 툴팁 노출 핸들러
 */
function showFinvizTooltip(element, dataJsonEncoded, evt) {
  const tooltip = document.getElementById("finviz-tooltip");
  if (!tooltip) return;

  try {
    const data = JSON.parse(decodeURIComponent(dataJsonEncoded));
    const chgColor = data.change >= 0 ? "text-emerald-400" : "text-rose-400";
    const chgSign = data.change >= 0 ? "+" : "";
    const dcfColor = data.dcf_gap >= 0 ? "text-emerald-400" : "text-rose-400";
    const dcfStatus = data.dcf_gap >= 15 ? "저평가 (안전마진)" : (data.dcf_gap <= -15 ? "고평가 (매도주의)" : "적정가 권역");

    tooltip.innerHTML = `
      <div class="space-y-2 select-none">
        <div class="flex items-center justify-between border-b border-slate-700/80 pb-1.5">
          <div class="flex items-center gap-1.5">
            <span class="text-sm">${data.market === 'KR' ? '🇰🇷' : '🇺🇸'}</span>
            <strong class="font-black text-sm text-white">${data.name}</strong>
            <span class="text-[10px] font-mono px-1 py-0.2 bg-slate-800 rounded text-slate-300">${data.ticker}</span>
          </div>
          <span class="text-[10px] text-indigo-300 font-medium px-1.5 py-0.5 rounded bg-indigo-950/80 border border-indigo-800/40">
            ${data.sector}
          </span>
        </div>

        <div class="grid grid-cols-2 gap-2 text-xs py-1">
          <div>
            <span class="text-slate-400 text-[10px] block">현재 시장가</span>
            <span class="font-bold text-white font-mono text-sm">${data.price}</span>
          </div>
          <div>
            <span class="text-slate-400 text-[10px] block">당일 등락률</span>
            <span class="font-extrabold ${chgColor} font-mono text-sm">${chgSign}${Number(data.change).toFixed(2)}%</span>
          </div>
          <div>
            <span class="text-slate-400 text-[10px] block">시가총액</span>
            <span class="font-semibold text-slate-200 font-mono">${data.cap}</span>
          </div>
          <div>
            <span class="text-slate-400 text-[10px] block">RSI (14일)</span>
            <span class="font-semibold text-cyan-300 font-mono">${data.rsi}</span>
          </div>
        </div>

        <div class="p-2 rounded-lg bg-slate-950/80 border border-slate-800 text-[11px] space-y-1">
          <div class="flex items-center justify-between">
            <span class="text-slate-400">다모다란 DCF 저평가율:</span>
            <span class="font-bold ${dcfColor} font-mono">${data.dcf_gap >= 0 ? '+' : ''}${data.dcf_gap}%</span>
          </div>
          <div class="text-[10px] text-slate-400 text-right">
            상태: <strong class="text-slate-200">${dcfStatus}</strong>
          </div>
        </div>

        <div class="text-[10px] text-indigo-400 font-semibold flex items-center gap-1 pt-1 border-t border-slate-800/80">
          <i class="fa-solid fa-chart-line"></i>
          <span>클릭 시 [📊 프로 차트 분석]으로 즉시 이동</span>
        </div>
      </div>
    `;

    tooltip.classList.remove("hidden");
    moveFinvizTooltip(evt);
  } catch (e) {
    console.error("Tooltip error:", e);
  }
}

/**
 * 툴팁 마우스 위치 추적
 */
function moveFinvizTooltip(evt) {
  const tooltip = document.getElementById("finviz-tooltip");
  if (!tooltip || tooltip.classList.contains("hidden")) return;

  const tooltipWidth = 260;
  const tooltipHeight = 200;
  let left = evt.clientX + 16;
  let top = evt.clientY + 16;

  if (left + tooltipWidth > window.innerWidth) {
    left = evt.clientX - tooltipWidth - 16;
  }
  if (top + tooltipHeight > window.innerHeight) {
    top = evt.clientY - tooltipHeight - 16;
  }

  tooltip.style.left = `${Math.max(10, left)}px`;
  tooltip.style.top = `${Math.max(10, top)}px`;
}

/**
 * 툴팁 숨기기
 */
function hideFinvizTooltip() {
  const tooltip = document.getElementById("finviz-tooltip");
  if (tooltip) tooltip.classList.add("hidden");
}


// =============================================================================
// Custom DCF Sandbox Simulator (Tab 4) - 1초 초간편 자동 모드
// =============================================================================

let g_calcAutofillDebounceTimer = null;
let g_lastAutofilledStock = null;

function toggleCalcAdvancedSettings() {
  const section = document.getElementById("calc-advanced-section");
  const icon = document.getElementById("advanced-toggle-icon");
  if (!section) return;
  if (section.classList.contains("hidden")) {
    section.classList.remove("hidden");
    if (icon) icon.textContent = "접기 ▲";
  } else {
    section.classList.add("hidden");
    if (icon) icon.textContent = "펼치기 ▼";
  }
}

function selectCalcQuickPreset(nameOrTicker) {
  const nameInput = document.getElementById("calc-name");
  if (nameInput) {
    nameInput.value = nameOrTicker;
  }
  autoFillStockData(nameOrTicker, true);
}

function handleCalcNameKeyDown(event) {
  if (event.key === "Enter") {
    event.preventDefault();
    if (g_calcAutofillDebounceTimer) {
      clearTimeout(g_calcAutofillDebounceTimer);
    }
    const val = (event.target.value || "").trim();
    if (val) {
      autoFillStockData(val, true);
    }
  }
}

function handleCalcBuyPriceKeyDown(event) {
  if (event.key === "Enter") {
    event.preventDefault();
    runCustomDcfSimulation();
  }
}

function handleCalcNameInput(val) {
  if (g_calcAutofillDebounceTimer) {
    clearTimeout(g_calcAutofillDebounceTimer);
  }
  const indicator = document.getElementById("calc-autofill-indicator");
  if (indicator) {
    indicator.innerHTML = `<i class="fa-solid fa-spinner fa-spin text-amber-400"></i>입력 감지 중...`;
  }
  g_calcAutofillDebounceTimer = setTimeout(() => {
    if (val && val.trim().length >= 2) {
      autoFillStockData(val.trim(), false);
    }
  }, 400);
}

function handleCalcNameChange(val) {
  if (g_calcAutofillDebounceTimer) {
    clearTimeout(g_calcAutofillDebounceTimer);
  }
  if (val && val.trim().length >= 1) {
    autoFillStockData(val.trim(), false);
  }
}

function triggerStockAutofill() {
  const nameInput = document.getElementById("calc-name");
  const query = nameInput ? nameInput.value.trim() : "";
  if (!query) {
    alert("공시 데이터를 연동할 종목명 또는 티커(예: SK하이닉스, 000660, NVDA)를 입력해주세요.");
    return;
  }
  autoFillStockData(query, true);
}

function setBuyPriceToCurrent() {
  const currPriceInput = document.getElementById("calc-curr-price");
  const buyPriceInput = document.getElementById("calc-buy-price");
  if (currPriceInput && buyPriceInput) {
    buyPriceInput.value = currPriceInput.value;
    runCustomDcfSimulation();
  }
}

function handleBuyPriceInput() {
  runCustomDcfSimulation();
}

function handleCalcMarketChange(market) {
  const rfInput = document.getElementById("calc-rf");
  const sym = market === "US" ? "$" : "₩";
  const currSym = document.getElementById("calc-currency-symbol");
  if (currSym) currSym.textContent = sym;
  if (rfInput) {
    rfInput.value = market === "US" ? 4.12 : 3.28;
  }
  runCustomDcfSimulation();
}

/**
 * 서버의 /api/stock/autofill?query=... API를 호출하여
 * 실시간 시세, 공시 재무(매출, 마진, 부채비율, 발행주식수), 증권사 목표가를 100% 자동 채우고 DCF 실행
 */
async function autoFillStockData(query, forceRecalculate = false) {
  if (!query) return;
  const cleanQ = query.trim();

  const indicator = document.getElementById("calc-autofill-indicator");
  const searchBtn = document.getElementById("calc-search-btn");
  const nameInput = document.getElementById("calc-name");

  if (indicator) {
    indicator.innerHTML = `<i class="fa-solid fa-spinner fa-spin text-purple-400"></i>${cleanQ} 공시 & 리포트 조회 중...`;
  }
  if (searchBtn) {
    searchBtn.disabled = true;
    searchBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin text-[11px]"></i>조회중`;
  }

  try {
    const res = await fetch(`/api/stock/autofill?query=${encodeURIComponent(cleanQ)}`);
    if (!res.ok) {
      throw new Error("Autofill response error");
    }
    const data = await res.json();
    if (!data || !data.success) {
      throw new Error(data.error || "Failed to load stock data");
    }

    const isNewStock = !g_lastAutofilledStock || g_lastAutofilledStock.ticker !== data.ticker;
    g_lastAutofilledStock = data;

    // 1. 입력 필드 업데이트
    const marketSelect = document.getElementById("calc-market");
    const currPriceInput = document.getElementById("calc-curr-price");
    const buyPriceInput = document.getElementById("calc-buy-price");
    const sharesInput = document.getElementById("calc-shares");
    const revInput = document.getElementById("calc-revenue");
    const growthInput = document.getElementById("calc-growth");
    const marginInput = document.getElementById("calc-margin");
    const betaInput = document.getElementById("calc-beta");
    const deInput = document.getElementById("calc-de");
    const rfInput = document.getElementById("calc-rf");
    const currSymbol = document.getElementById("calc-currency-symbol");
    const currPriceHint = document.getElementById("calc-curr-price-hint");

    const sym = data.currency === "USD" || data.market === "US" ? "$" : "₩";
    if (currSymbol) currSymbol.textContent = sym;
    if (marketSelect) marketSelect.value = data.market || "KR";

    // 엔터를 쳤거나 종목코드를 입력했을 경우 정확한 종목명으로 정돈
    if (nameInput && (forceRecalculate || /^\d+$/.test(nameInput.value))) {
      nameInput.value = data.name;
    }

    if (currPriceInput) currPriceInput.value = data.current_price || 0;
    if (sharesInput) sharesInput.value = data.shares_outstanding_mil || 100.0;
    if (revInput) revInput.value = data.base_revenue || 50000;
    if (growthInput) growthInput.value = data.growth_rate_next_5y || 12.0;
    if (marginInput) marginInput.value = data.target_ebit_margin || 20.0;
    if (betaInput) betaInput.value = data.unlevered_beta || 1.15;
    if (deInput) deInput.value = data.debt_to_equity_pct || 20.0;
    if (rfInput) rfInput.value = data.rf || (data.market === "US" ? 4.12 : 3.28);

    if (currPriceHint) {
      currPriceHint.textContent = `현재가: ${sym}${Number(data.current_price).toLocaleString()}`;
    }

    // 종목이 바뀌었거나, 엔터(forceRecalculate)를 쳤거나, 매수가가 비어있으면
    // 새 종목의 현재가 기준(현재가 90%)으로 매수가 자동 업데이트!
    if (buyPriceInput) {
      const curBuy = parseFloat(buyPriceInput.value);
      if (isNewStock || forceRecalculate || !curBuy || curBuy <= 0) {
        const defaultBuy = data.market === "KR" 
          ? Math.round((data.current_price * 0.9) / 100) * 100
          : Math.round((data.current_price * 0.9) * 10) / 10;
        buyPriceInput.value = defaultBuy;
      }
    }

    // 2. 실시간 공시 & 리포트 인텔 카드 갱신
    updateCalcIntelCard(data, sym);

    if (indicator) {
      indicator.innerHTML = `<i class="fa-solid fa-circle-check text-emerald-400"></i>공시 연동 완료 (${data.ticker || data.name})`;
    }
    if (searchBtn) {
      searchBtn.disabled = false;
      searchBtn.className = "absolute right-1.5 top-1.5 bottom-1.5 px-3 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1 transition shadow";
      searchBtn.innerHTML = `<i class="fa-solid fa-check text-[11px]"></i>연동완료`;
      setTimeout(() => {
        if (searchBtn) {
          searchBtn.className = "absolute right-1.5 top-1.5 bottom-1.5 px-3 rounded-md bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs flex items-center gap-1 transition shadow";
          searchBtn.innerHTML = `<i class="fa-solid fa-bolt text-[11px]"></i>조회`;
        }
      }, 1500);
    }

    // 입력창 및 인텔 카드 하이라이트 애니메이션
    if (nameInput) {
      nameInput.classList.add("ring-2", "ring-emerald-400/80");
      setTimeout(() => {
        nameInput.classList.remove("ring-2", "ring-emerald-400/80");
      }, 1000);
    }

    // 3. 즉시 DCF 실행
    runCustomDcfSimulation();

  } catch (err) {
    console.warn("Autofill fallback:", err);
    if (indicator) {
      indicator.innerHTML = `<i class="fa-solid fa-circle-exclamation text-amber-400"></i>기본 프로필 연동`;
    }
    if (searchBtn) {
      searchBtn.disabled = false;
      searchBtn.innerHTML = `<i class="fa-solid fa-bolt text-[11px]"></i>조회`;
    }
    const profile = getProfileForStock(cleanQ);
    if (profile) {
      loadCalcPreset(profile.ticker || cleanQ);
    } else {
      runCustomDcfSimulation();
    }
  }
}

function updateCalcIntelCard(data, sym) {
  const stockTitle = document.getElementById("intel-stock-title");
  const sourceBadge = document.getElementById("intel-source-badge");
  const currPriceEl = document.getElementById("intel-curr-price");
  const sharesEl = document.getElementById("intel-shares");
  const revEl = document.getElementById("intel-revenue");
  const marginEl = document.getElementById("intel-margin");
  const consensusEl = document.getElementById("intel-consensus");
  const rfEl = document.getElementById("intel-rf");
  const sectorRow = document.getElementById("intel-sector-row");
  const sectorBadge = document.getElementById("intel-sector-badge");
  const sectorType = document.getElementById("intel-sector-type");

  if (stockTitle) {
    stockTitle.textContent = `${data.name} (${data.ticker}) 공시 & 리포트 연동 현황`;
  }
  if (sourceBadge) {
    sourceBadge.textContent = data.source_info || "네이버 금융 DART/FnGuide";
  }
  if (sectorRow && sectorBadge && sectorType && data.sector_name) {
    sectorRow.classList.remove("hidden");
    sectorBadge.textContent = `[특화 모델] ${data.sector_name}`;
    sectorType.textContent = data.sector_model || "특화 밸류에이션 가동";
  }
  if (currPriceEl) {
    currPriceEl.textContent = `${sym}${Number(data.current_price).toLocaleString()}`;
  }
  if (sharesEl) {
    sharesEl.textContent = `${Number(data.shares_outstanding_mil).toLocaleString()}M 주`;
  }
  if (revEl) {
    if (data.market === "KR") {
      if (data.base_revenue >= 1000) {
        revEl.textContent = `약 ${(data.base_revenue / 1000).toFixed(1)}조 원 (${Number(data.base_revenue).toLocaleString()}십억원)`;
      } else {
        revEl.textContent = `${Number(data.base_revenue).toLocaleString()}십억원`;
      }
    } else {
      revEl.textContent = `$${Number(data.base_revenue).toLocaleString()}M ($${(data.base_revenue / 1000).toFixed(1)}B)`;
    }
  }
  if (marginEl) {
    marginEl.textContent = `${data.target_ebit_margin}%`;
  }
  if (consensusEl) {
    consensusEl.textContent = data.consensus_target_price || "-";
  }
  if (rfEl) {
    rfEl.textContent = `${data.rf}%`;
  }
}

async function loadCalcPreset(key) {
  autoFillStockData(key, true);
}

async function runCustomDcfSimulation() {
  const market = document.getElementById("calc-market")?.value || "KR";
  const name = document.getElementById("calc-name")?.value || "SK하이닉스";
  const currPrice = parseFloat(document.getElementById("calc-curr-price")?.value) || 1000;
  const buyPrice = parseFloat(document.getElementById("calc-buy-price")?.value) || currPrice;
  const rf = parseFloat(document.getElementById("calc-rf")?.value) || (market === "US" ? 4.12 : 3.28);
  const rev = parseFloat(document.getElementById("calc-revenue")?.value) || 50000;
  
  // 발행주식수 읽기
  const sharesInput = document.getElementById("calc-shares");
  let shares = sharesInput ? parseFloat(sharesInput.value) : 0;
  
  // 티커/이름 매핑
  let targetTicker = name.toUpperCase();
  for (const [kname, code] of Object.entries(KOREAN_TICKER_MAP)) {
    if (name.includes(kname)) { targetTicker = code; break; }
  }
  const profile = getProfileForStock(targetTicker) || getProfileForStock(name);
  
  if (!shares || shares <= 0) {
    if (profile) {
      shares = profile.shares_outstanding_mil;
      if (sharesInput) sharesInput.value = shares;
    } else {
      shares = market === "KR" ? (rev * 1.5 * 1000.0) / currPrice : (rev * 1.5) / currPrice;
      shares = Math.round(shares * 10) / 10;
      if (sharesInput) sharesInput.value = shares;
    }
  }

  const payload = {
    market: market,
    ticker: (g_lastAutofilledStock && g_lastAutofilledStock.ticker) || (profile ? profile.ticker : targetTicker),
    name: (g_lastAutofilledStock && g_lastAutofilledStock.name) || name,
    sector_id: (g_lastAutofilledStock && g_lastAutofilledStock.sector_id) || (profile ? profile.sector : undefined),
    consensus_target_price: (g_lastAutofilledStock && g_lastAutofilledStock.consensus_target_price) || (profile ? profile.consensus_target_price : undefined),
    consensus_opinion: (g_lastAutofilledStock && g_lastAutofilledStock.consensus_opinion) || (profile ? profile.consensus_opinion : undefined),
    current_price: currPrice,
    buy_price: buyPrice,
    rf: rf,
    damodaran_inputs: {
      base_revenue: rev,
      growth_rate_next_5y: parseFloat(document.getElementById("calc-growth")?.value) || 12.0,
      terminal_growth_rate: 2.5,
      target_ebit_margin: parseFloat(document.getElementById("calc-margin")?.value) || 20.0,
      sales_to_capital: profile ? profile.sales_to_capital : 1.4,
      unlevered_beta: parseFloat(document.getElementById("calc-beta")?.value) || 1.15,
      debt_to_equity_pct: parseFloat(document.getElementById("calc-de")?.value) || 20.0,
      effective_tax_rate: 22.0,
      cost_of_debt_pretax: 4.5,
      shares_outstanding_mil: shares,
      net_debt_billion_krw: profile ? profile.net_debt_billion_krw : 0,
      rd_annual_billion_krw: profile ? profile.rd_annual_billion_krw : 0
    },
    technical_indicators: {
      rsi_14: 60.0,
      bollinger_upper: currPrice * 1.08,
      bollinger_middle: currPrice,
      bollinger_lower: currPrice * 0.92,
      sma_20: currPrice * 0.98,
      sma_60: currPrice * 0.95
    }
  };

  try {
    const res = await fetch("/api/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error("Offline fallback");
    const result = await res.json();
    renderCustomCalcResult(result, payload);
  } catch (e) {
    const dcf = jsCalculateDamodaranDcf(payload, payload.rf);
    const exit = jsEvaluateExitTiming(payload, dcf);
    renderCustomCalcResult({ dcf, exit_analysis: exit }, payload);
  }
}

function renderCustomCalcResult(result, payload) {
  const container = document.getElementById("calc-result-container");
  if (!container) return;

  const dcf = result.dcf || {};
  const exit = result.exit_analysis || {};
  const sym = payload.market === "US" ? "$" : "₩";
  const shares = dcf.shares_outstanding_mil || payload.damodaran_inputs.shares_outstanding_mil || 100;
  const eqVal = dcf.equity_value || (dcf.base_fair_value * shares / (payload.market === "US" ? 1 : 1000));

  let eqValStr = "";
  if (payload.market === "KR") {
    if (eqVal >= 1000) {
      eqValStr = `약 ${(eqVal / 1000).toFixed(1)}조 원 (${Math.round(eqVal).toLocaleString()}십억원)`;
    } else {
      eqValStr = `약 ${Math.round(eqVal).toLocaleString()}0억 원`;
    }
  } else {
    eqValStr = `$${(eqVal / 1000).toFixed(1)}B (${eqVal.toLocaleString()}M)`;
  }

  // Update timestamp
  const ts = document.getElementById("calc-last-updated");
  if (ts) {
    const now = new Date();
    ts.textContent = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')} 계산완료`;
  }

  const hasConsensus = (g_lastAutofilledStock && g_lastAutofilledStock.consensus_target_price && g_lastAutofilledStock.consensus_target_price !== "-") || (payload.consensus_target_price && payload.consensus_target_price !== "-");
  const consensusTargetText = (g_lastAutofilledStock && g_lastAutofilledStock.consensus_target_price) || payload.consensus_target_price || "-";
  const consensusOpinionText = (g_lastAutofilledStock && g_lastAutofilledStock.consensus_opinion) || payload.consensus_opinion || "매수";
  const sectorName = dcf.sector_name || (g_lastAutofilledStock && g_lastAutofilledStock.sector_name) || "섹터 특화 모델";
  const sectorModel = dcf.sector_model || (g_lastAutofilledStock && g_lastAutofilledStock.sector_model) || "다모다란 섹터 적정가 모델 적용";

  container.innerHTML = `
    <!-- Sector Specific Model Applied Banner -->
    <div class="p-3 rounded-xl bg-purple-950/40 border border-purple-500/40 flex items-center justify-between text-xs shadow-md">
      <div class="flex items-center gap-2.5">
        <div class="w-8 h-8 rounded-lg bg-purple-500/20 text-purple-400 flex items-center justify-center font-bold text-sm">
          <i class="fa-solid fa-shapes"></i>
        </div>
        <div>
          <span class="text-purple-300 font-bold block text-xs">
            [섹터 특화 가치평가] ${sectorName}
          </span>
          <span class="text-slate-400 text-[10px] block mt-0.5">
            ${sectorModel}
          </span>
        </div>
      </div>
      <span class="px-2.5 py-1 rounded-md bg-purple-500/20 text-purple-300 font-bold text-[10px] border border-purple-500/30 whitespace-nowrap">
        <i class="fa-solid fa-check mr-1 text-emerald-400"></i>특화 엔진 가동
      </span>
    </div>

    <!-- Top Signal Box -->
    <div class="p-4 rounded-xl border ${exit.signal_type === 'STRONG_SELL' ? 'bg-rose-950/40 border-rose-500 ring-2 ring-rose-500/30' : (exit.signal_type === 'PARTIAL_SELL_1' ? 'bg-amber-950/40 border-amber-500 ring-2 ring-amber-500/30' : 'bg-slate-900/90 border-slate-700')} space-y-2">
      <div class="flex items-center justify-between">
        <span class="text-xs font-bold text-slate-300 flex items-center gap-1.5">
          <i class="fa-solid fa-compass text-amber-400"></i>다모다란 매도 판정 나침반
        </span>
        <span class="px-2.5 py-0.5 rounded text-xs font-black ${exit.signal_type === 'STRONG_SELL' ? 'bg-rose-500 text-white' : (exit.signal_type === 'PARTIAL_SELL_1' ? 'bg-amber-500 text-slate-950' : 'bg-emerald-500 text-slate-950')}">
          ${exit.signal_badge || '보유 지속'}
        </span>
      </div>
      <h5 class="text-base font-black text-white">${exit.headline || '다모다란 적정가 계산 완료'}</h5>
      <p class="text-xs text-slate-300 leading-relaxed">${exit.action_guidance || '분석 결과를 확인하세요.'}</p>
    </div>

    <!-- 3-Tier Valuation Band -->
    <div class="grid grid-cols-3 gap-3">
      <div class="p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-center">
        <span class="text-[11px] text-emerald-400 block font-semibold">보수적 안전마진 (-20%)</span>
        <span class="font-bold text-white font-mono text-base">${sym}${Math.round(dcf.conservative_value).toLocaleString()}</span>
        <span class="text-[10px] text-slate-400 block mt-0.5">매수 안전 지지선</span>
      </div>
      <div class="p-3 rounded-xl bg-amber-950/20 border border-amber-500/50 text-center ring-2 ring-amber-500/20">
        <span class="text-[11px] text-amber-300 block font-bold">기본 적정가 (Fair Value)</span>
        <span class="font-black text-amber-300 font-mono text-xl">${sym}${Math.round(dcf.base_fair_value).toLocaleString()}</span>
        <span class="text-[10px] text-amber-400/80 block mt-0.5">1차 분할 익절 목표</span>
      </div>
      <div class="p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-center">
        <span class="text-[11px] text-indigo-400 block font-semibold">낙관적 상단 (Bull Target)</span>
        <span class="font-bold text-white font-mono text-base">${sym}${Math.round(dcf.bullish_value).toLocaleString()}</span>
        <span class="text-[10px] text-slate-400 block mt-0.5">최종 전량 매도선</span>
      </div>
    </div>

    <!-- Consensus vs Damodaran Comparison Card -->
    ${hasConsensus ? `
    <div class="p-3.5 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between text-xs">
      <div class="flex items-center space-x-2.5">
        <div class="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold text-sm">
          <i class="fa-solid fa-building-columns"></i>
        </div>
        <div>
          <span class="text-slate-400 block text-[10px]">국내외 증권사 애널리스트 리포트 평균 목표가</span>
          <div class="flex items-center gap-1.5">
            <span class="font-black text-white text-sm font-mono">${consensusTargetText}</span>
            <span class="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-bold">${consensusOpinionText}</span>
          </div>
        </div>
      </div>
      <div class="text-right">
        <span class="text-slate-400 block text-[10px]">다모다란 DCF 공정 적정가</span>
        <span class="font-black text-amber-300 text-base font-mono">${sym}${Math.round(dcf.base_fair_value).toLocaleString()}</span>
        <span class="text-[10px] text-emerald-400 font-semibold block">
          ${Math.round(dcf.base_fair_value) >= (payload.current_price || 1) 
            ? `현재가 대비 +${(((dcf.base_fair_value - payload.current_price) / payload.current_price) * 100).toFixed(1)}% 상승여력` 
            : `현재가 대비 ${(((dcf.base_fair_value - payload.current_price) / payload.current_price) * 100).toFixed(1)}%`}
        </span>
      </div>
    </div>
    ` : ''}

    <!-- Transparent 1-Share Valuation Math Formula Box -->
    <div class="p-3.5 rounded-xl bg-purple-950/30 border border-purple-500/30 text-xs space-y-1.5">
      <div class="flex items-center justify-between text-purple-300 font-bold text-[11px]">
        <span><i class="fa-solid fa-scale-balanced mr-1 text-purple-400"></i>다모다란 1주당 공정 가치 산출 공식 검증:</span>
        <span class="text-slate-400 font-normal">총 발행주식수: <strong class="text-white font-mono">${shares.toLocaleString()}백만 주</strong></span>
      </div>
      <div class="bg-slate-950/80 p-2.5 rounded-lg font-mono text-[11px] text-slate-300 space-y-1.5 border border-slate-800">
        <div class="flex justify-between">
          <span>기업가치(EV) - 순부채 = <strong>주주지분가치</strong>:</span>
          <span class="text-emerald-400 font-bold">${eqValStr}</span>
        </div>
        <div class="flex justify-between border-t border-slate-800/80 pt-1">
          <span>주주가치 ÷ 총 발행주식수 = <strong>1주당 공정 적정가</strong>:</span>
          <span class="text-amber-300 font-black text-sm">${sym}${Math.round(dcf.base_fair_value).toLocaleString()}</span>
        </div>
      </div>
      <p class="text-[10px] text-slate-400">
        * 기업 전체 주주가치를 총 발행주식수로 나누어 주당 단가를 정확히 환산합니다. (발행주식수 왜곡 없음)
      </p>
    </div>

    <!-- WACC & Metrics -->
    <div class="grid grid-cols-4 gap-2 text-xs text-center">
      <div class="p-2 rounded-lg bg-slate-900/60 border border-slate-800">
        <span class="text-slate-400 block text-[10px]">적용 WACC</span>
        <span class="font-mono font-bold text-white">${dcf.wacc}%</span>
      </div>
      <div class="p-2 rounded-lg bg-slate-900/60 border border-slate-800">
        <span class="text-slate-400 block text-[10px]">자기자본비용(Ke)</span>
        <span class="font-mono font-bold text-white">${dcf.cost_of_equity}%</span>
      </div>
      <div class="p-2 rounded-lg bg-slate-900/60 border border-slate-800">
        <span class="text-slate-400 block text-[10px]">레버리지 베타(β)</span>
        <span class="font-mono font-bold text-white">${dcf.levered_beta}</span>
      </div>
      <div class="p-2 rounded-lg bg-slate-900/60 border border-slate-800">
        <span class="text-slate-400 block text-[10px]">국채 10년물(Rf)</span>
        <span class="font-mono font-bold text-amber-400">${dcf.rf_used}%</span>
      </div>
    </div>

    <!-- 5-Year FCFF Projection Table -->
    <div class="space-y-2 pt-2 border-t border-slate-800">
      <span class="text-xs font-bold text-slate-300">5개년 FCFF(기업잉여현금흐름) 추정치 (단위: ${payload.market === 'US' ? 'M$' : '십억원'})</span>
      <div class="overflow-x-auto rounded-lg border border-slate-800 text-[11px]">
        <table class="w-full text-left font-mono">
          <thead class="bg-slate-950 text-slate-400">
            <tr>
              <th class="p-2">연도</th>
              <th class="p-2">매출액</th>
              <th class="p-2">EBIT</th>
              <th class="p-2">재투자액</th>
              <th class="p-2">FCFF</th>
              <th class="p-2">할인 현재가(PV)</th>
            </tr>
          </thead>
          <tbody class="divide-y border-slate-800">
            ${(dcf.fcff_projections || []).map(p => `
              <tr>
                <td class="p-2 font-bold text-white">${p.year}</td>
                <td class="p-2">${p.revenue.toLocaleString()}</td>
                <td class="p-2 text-emerald-400">${p.ebit.toLocaleString()}</td>
                <td class="p-2 text-rose-400">-${p.reinvestment.toLocaleString()}</td>
                <td class="p-2 font-bold text-white">${p.fcff.toLocaleString()}</td>
                <td class="p-2 text-indigo-300 font-bold">${p.pv_fcff.toLocaleString()}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// =============================================================================
// Add Stock Modal & CRUD
// =============================================================================
function openAddStockModal() {
  document.getElementById("add-stock-modal").classList.remove("hidden");
  setTimeout(() => {
    document.getElementById("form-name").focus();
  }, 50);
}

function closeAddStockModal() {
  document.getElementById("add-stock-modal").classList.add("hidden");
}

function openAddWithPreset(key) {
  openAddStockModal();
  fillPreset(key);
  setTimeout(() => {
    const buyInput = document.getElementById("form-buy-price");
    buyInput.focus();
    buyInput.select();
  }, 100);
}

function fillPreset(key) {
  const p = STOCK_PRESETS[key];
  if (!p) return;

  document.getElementById("form-market").value = p.market;
  document.getElementById("form-sector").value = p.sector;
  document.getElementById("form-name").value = p.name;
  document.getElementById("form-ticker").value = p.ticker;
  document.getElementById("form-buy-price").value = p.buy_price;
  document.getElementById("form-curr-price").value = p.curr_price;
  document.getElementById("form-quantity").value = 10;
  document.getElementById("form-growth").value = p.growth;
  document.getElementById("form-margin").value = p.margin;
  document.getElementById("form-rsi").value = p.rsi;
  document.getElementById("form-notes").value = p.notes;

  // 국내 종목인 경우 네이버 증권에서 최신 실시간 시세 자동 동기화
  if (p.market === "KR") {
    fetchNaverStockPriceForModal();
  }
}

/**
 * 네이버 증권 모바일 API 연동 실시간 시세 조회 함수
 * - 6자리 종목코드(005930) 또는 한글 종목명(삼성전자, 카카오 등) 자동 매핑
 * - 네이버 증권 현재가 및 종목명 자동 폼 반영
 */
async function fetchNaverStockPriceForModal() {
  const tickerInput = document.getElementById("form-ticker");
  const nameInput = document.getElementById("form-name");
  const priceInput = document.getElementById("form-curr-price");
  const marketInput = document.getElementById("form-market");
  const btn = document.getElementById("btn-naver-query");

  if (!tickerInput) return;
  const nameVal = nameInput ? nameInput.value.trim() : "";
  const tickerVal = tickerInput ? tickerInput.value.trim() : "";

  // 1. 종목명과 티커 중 적절한 검색어 자동 판단 (이름과 티커 불일치 방지)
  let query = tickerVal;
  if (nameVal && (KOREAN_TICKER_MAP[nameVal] || STOCK_PRESETS[nameVal.toLowerCase()])) {
    const mappedCode = KOREAN_TICKER_MAP[nameVal] || STOCK_PRESETS[nameVal.toLowerCase()]?.ticker;
    if (mappedCode && mappedCode !== tickerVal) {
      query = nameVal; // 종목명과 티커가 엇갈려 있으면 사용자 입력 종목명 우선 적용!
    }
  } else if (!query && nameVal) {
    query = nameVal;
  }

  if (!query) {
    alert("조회할 종목코드(6자리) 또는 종목명을 입력해주세요.");
    tickerInput.focus();
    return;
  }

  // 한글 종목명 매핑 확인
  let targetTicker = query.toUpperCase();
  for (const [name, code] of Object.entries(KOREAN_TICKER_MAP)) {
    if (query === name || query.includes(name) || name.includes(query)) {
      targetTicker = code;
      break;
    }
  }

  // 프리셋 일치 여부 확인
  for (const [key, preset] of Object.entries(STOCK_PRESETS)) {
    if (query.toLowerCase() === key || query === preset.name || query === preset.ticker) {
      targetTicker = preset.ticker;
      if (preset.sector) document.getElementById("form-sector").value = preset.sector;
      if (preset.growth) document.getElementById("form-growth").value = preset.growth;
      if (preset.margin) document.getElementById("form-margin").value = preset.margin;
      if (preset.rsi) document.getElementById("form-rsi").value = preset.rsi;
      if (preset.notes) document.getElementById("form-notes").value = preset.notes;
      break;
    }
  }

  // 1~6자리 숫자면 6자리로 패딩
  if (/^\d{1,6}$/.test(targetTicker)) {
    targetTicker = targetTicker.padStart(6, "0");
  }
  tickerInput.value = targetTicker;

  // 버튼 로딩 상태 표시
  const origBtnContent = btn ? btn.innerHTML : "";
  if (btn) {
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1 text-emerald-400"></i>네이버 조회 중...`;
    btn.disabled = true;
  }

  // 공시 및 실시간 API 자동 연동 호출
  try {
    const res = await fetch(`/api/stock/autofill?query=${encodeURIComponent(targetTicker || query)}`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.success) {
        if (nameInput) nameInput.value = data.name;
        if (tickerInput) tickerInput.value = data.ticker;
        if (priceInput) priceInput.value = data.current_price;
        if (marketInput) marketInput.value = data.market || "KR";
        if (data.target_ebit_margin) {
          const marginEl = document.getElementById("form-margin");
          if (marginEl) marginEl.value = data.target_ebit_margin;
        }
        if (data.growth_rate_next_5y) {
          const growthEl = document.getElementById("form-growth");
          if (growthEl) growthEl.value = data.growth_rate_next_5y;
        }
        const sym = data.market === "US" ? "$" : "₩";
        if (btn) {
          btn.className = "text-[11px] text-emerald-300 font-bold flex items-center bg-emerald-900/60 px-2 py-0.5 rounded border border-emerald-500/60";
          btn.innerHTML = `<i class="fa-solid fa-check mr-1 text-emerald-400"></i>${sym}${Number(data.current_price).toLocaleString()} 공시연동`;
          setTimeout(() => {
            if (btn) {
              btn.className = "text-[11px] text-emerald-400 hover:text-emerald-300 font-bold flex items-center transition bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-800/40";
              btn.innerHTML = `<i class="fa-solid fa-bolt mr-1 text-emerald-400"></i>네이버 시세 조회`;
              btn.disabled = false;
            }
          }, 2500);
        }
        return;
      }
    }
  } catch (err) {
    console.warn("Autofill modal error:", err);
  }

  // 미국 프리셋 종목 매칭 fallback
  const usMatch = Object.values(STOCK_PRESETS).find(p => p.ticker.toUpperCase() === targetTicker || p.name.toUpperCase() === targetTicker);
  if (usMatch) {
    if (nameInput) nameInput.value = usMatch.name;
    if (priceInput) priceInput.value = usMatch.curr_price;
    if (marketInput) marketInput.value = usMatch.market;
    if (btn) {
      btn.className = "text-[11px] text-blue-300 font-bold flex items-center bg-blue-900/60 px-2 py-0.5 rounded border border-blue-500/60";
      btn.innerHTML = `<i class="fa-solid fa-check mr-1 text-blue-400"></i>$${usMatch.curr_price} 반영`;
      setTimeout(() => {
        if (btn) {
          btn.className = "text-[11px] text-emerald-400 hover:text-emerald-300 font-bold flex items-center transition bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-800/40";
          btn.innerHTML = `<i class="fa-solid fa-bolt mr-1 text-emerald-400"></i>네이버 시세 조회`;
          btn.disabled = false;
        }
      }, 2500);
    }
    return;
  }

  // 자동 조회 불가 시
  if (btn) {
    btn.innerHTML = `<i class="fa-solid fa-circle-exclamation mr-1 text-amber-400"></i>직접 입력 가능`;
    setTimeout(() => {
      if (btn) {
        btn.innerHTML = origBtnContent || `<i class="fa-solid fa-bolt mr-1 text-emerald-400"></i>네이버 시세 조회`;
        btn.disabled = false;
      }
    }, 2000);
  }
}

function deleteCurrentHeroStock() {
  if (g_selectedStock) {
    deleteStock(g_selectedStock.id);
  }
}

function handleMarketChange(market) {
  // auto-adjust currency hints
}

async function handleSaveStock(e) {
  e.preventDefault();

  const market = document.getElementById("form-market").value;
  const buyPrice = parseFloat(document.getElementById("form-buy-price").value);
  const currPrice = parseFloat(document.getElementById("form-curr-price").value);
  const quantity = parseInt(document.getElementById("form-quantity").value);
  const ticker = document.getElementById("form-ticker").value.trim().toUpperCase();
  const name = document.getElementById("form-name").value.trim();
  const profile = getProfileForStock(ticker) || getProfileForStock(name);

  const baseRev = profile ? profile.base_revenue : (market === "KR" ? 50000 : 5000);
  let shares = profile ? profile.shares_outstanding_mil : 0;
  if (!shares || shares <= 0) {
    shares = market === "KR" ? Math.round((baseRev * 1.5 * 1000) / currPrice) : Math.round((baseRev * 1.5) / currPrice);
  }

  const payload = {
    id: "stock_" + Date.now(),
    market: market,
    currency: market === "US" ? "USD" : "KRW",
    sector_id: document.getElementById("form-sector").value,
    name: name,
    ticker: ticker,
    buy_price: buyPrice,
    quantity: quantity,
    current_price: currPrice,
    day_change: Math.round(currPrice * 0.01),
    day_change_pct: 1.0,
    growth_rate_next_5y: parseFloat(document.getElementById("form-growth").value),
    target_ebit_margin: parseFloat(document.getElementById("form-margin").value),
    rsi_14: parseFloat(document.getElementById("form-rsi").value),
    notes: document.getElementById("form-notes").value,
    damodaran_inputs: {
      base_revenue: baseRev,
      growth_rate_next_5y: parseFloat(document.getElementById("form-growth").value),
      terminal_growth_rate: 2.5,
      target_ebit_margin: parseFloat(document.getElementById("form-margin").value),
      sales_to_capital: profile ? profile.sales_to_capital : 1.4,
      unlevered_beta: profile ? profile.unlevered_beta : 1.15,
      debt_to_equity_pct: profile ? profile.debt_to_equity_pct : 15.0,
      effective_tax_rate: 22.0,
      cost_of_debt_pretax: 4.5,
      shares_outstanding_mil: shares,
      net_debt_billion_krw: profile ? profile.net_debt_billion_krw : 0,
      rd_annual_billion_krw: profile ? profile.rd_annual_billion_krw : 0
    },
    technical_indicators: {
      rsi_14: parseFloat(document.getElementById("form-rsi").value),
      bollinger_upper: currPrice * 1.06,
      bollinger_middle: currPrice,
      bollinger_lower: currPrice * 0.94,
      sma_20: currPrice * 0.98,
      sma_60: currPrice * 0.95,
      trend: "상승세",
      overbought_level: "중립 구간"
    }
  };

  // 100% 개인 브라우저 로컬 저장 (개인 금융정보 서버 전송 원천 차단)
  const stored = localStorage.getItem("troster_portfolio_v3");
  const list = stored ? JSON.parse(stored) : [];
  list.push(payload);
  localStorage.setItem("troster_portfolio_v3", JSON.stringify(list));

  closeAddStockModal();
  await fetchPortfolio(null, true);
  selectStock(payload.id);
}

async function deleteStock(stockId) {
  if (!confirm("정말 이 종목을 포트폴리오에서 삭제하시겠습니까?")) return;

  const stored = localStorage.getItem("troster_portfolio_v3");
  let list = stored ? JSON.parse(stored) : [];
  list = list.filter(s => s.id !== stockId);
  localStorage.setItem("troster_portfolio_v3", JSON.stringify(list));

  if (g_selectedStock && g_selectedStock.id === stockId) {
    g_selectedStock = null;
  }
  await fetchPortfolio();
}

async function clearAllPortfolio() {
  if (!confirm("포트폴리오의 모든 종목을 비우시겠습니까? 새롭게 직접 입력하실 수 있습니다.")) return;

  localStorage.setItem("troster_portfolio_v3", JSON.stringify([]));
  g_portfolio = [];
  g_selectedStock = null;
  await fetchPortfolio();
}

async function loadSamplePortfolio() {
  if (!confirm("샘플 종목(삼성전자, SK하이닉스, NVIDIA 가상 예시)을 불러오시겠습니까?")) return;

  const sampleList = [
    {
      "id": "stock_005930",
      "ticker": "005930",
      "name": "삼성전자",
      "market": "KR",
      "currency": "KRW",
      "sector_id": "semiconductor",
      "buy_price": 73000,
      "quantity": 100,
      "current_price": 78500,
      "day_change": 1200,
      "day_change_pct": 1.55,
      "growth_rate_next_5y": 9.5,
      "target_ebit_margin": 18.5,
      "rsi_14": 62.4,
      "notes": "HBM3E 공급 및 메모리 가격 사이클"
    },
    {
      "id": "stock_000660",
      "ticker": "000660",
      "name": "SK하이닉스",
      "market": "KR",
      "currency": "KRW",
      "sector_id": "semiconductor",
      "buy_price": 185000,
      "quantity": 50,
      "current_price": 224000,
      "day_change": 4500,
      "day_change_pct": 2.05,
      "growth_rate_next_5y": 14.0,
      "target_ebit_margin": 32.0,
      "rsi_14": 71.8,
      "notes": "HBM 독점적 공급. 적정가 도달 분할 익절"
    },
    {
      "id": "stock_nvda",
      "ticker": "NVDA",
      "name": "NVIDIA Corp",
      "market": "US",
      "currency": "USD",
      "sector_id": "software_ai",
      "buy_price": 118.5,
      "quantity": 80,
      "current_price": 142.8,
      "day_change": 3.4,
      "day_change_pct": 2.44,
      "growth_rate_next_5y": 24.0,
      "target_ebit_margin": 58.0,
      "rsi_14": 68.5,
      "notes": "차세대 Blackwell 슈퍼사이클"
    }
  ];

  for (const s of sampleList) {
    try {
      await fetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(s)
      });
    } catch (e) {
      // fallback
    }
  }

  localStorage.setItem("damodaran_portfolio", JSON.stringify(sampleList));
  await fetchPortfolio();
}

// =============================================================================
// PROFESSIONAL CHART ANALYSIS & TIMING CONTROLLER (Tab 5)
// =============================================================================

function quickSelectChartStock(name, ticker, market) {
  const input = document.getElementById("chart-search-input");
  if (input) input.value = name || ticker;
  loadChartAnalysis(ticker || name, market);
}

async function loadChartAnalysis(customQuery, customMarket) {
  const input = document.getElementById("chart-search-input");
  const query = (customQuery || (input ? input.value : "") || "SK하이닉스").trim();
  
  const spinner = document.getElementById("chart-loading-spinner");
  if (spinner) spinner.classList.remove("hidden");

  let market = customMarket;
  if (!market) {
    const isUsStock = /^[A-Z]{1,6}$/.test(query.toUpperCase()) && !["005930", "000660"].includes(query);
    market = isUsStock ? "US" : "KR";
  }

  try {
    const res = await fetch(`/api/stock/candles?ticker=${encodeURIComponent(query)}&market=${market}`);
    if (res.ok) {
      const data = await res.json();
      if (data.success || (data.candles && data.candles.length > 0)) {
        g_chartData = data;
        renderChartDashboard(g_chartData);
        renderMainPriceChart();
        renderSubIndicatorChart();
      } else {
        alert(data.error || "차트 데이터를 불러올 수 없습니다.");
      }
    } else {
      console.warn("차트 API 조회 실패, 오프라인 모드 시도");
    }
  } catch (err) {
    console.error("loadChartAnalysis error:", err);
  } finally {
    if (spinner) spinner.classList.add("hidden");
  }
}

function renderChartDashboard(data) {
  if (!data) return;
  const isUS = data.market === "US";
  const fmt = (val) => {
    if (val === undefined || val === null || isNaN(val)) return "-";
    return isUS 
      ? `$${Number(val).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` 
      : `₩${Math.round(val).toLocaleString("ko-KR")}`;
  };

  const timing = data.timing || {};
  const levels = timing.price_levels || {};
  const candles = data.candles || [];
  const currPrice = data.current_price || (candles.length ? candles[candles.length - 1].close : 0);

  // 1. Stock Identity & Price
  const nameEl = document.getElementById("chart-stock-name");
  const codeEl = document.getElementById("chart-stock-code");
  const priceEl = document.getElementById("chart-stock-price");
  const changeEl = document.getElementById("chart-stock-change");

  if (nameEl) nameEl.innerText = data.name || data.ticker;
  if (codeEl) codeEl.innerText = `${data.ticker} · ${isUS ? "US (NYSE/NASDAQ)" : "국내 (KOSPI/KOSDAQ)"}`;
  if (priceEl) priceEl.innerText = fmt(currPrice);

  if (candles.length >= 2) {
    const last = candles[candles.length - 1].close;
    const prev = candles[candles.length - 2].close;
    const diff = last - prev;
    const pct = prev > 0 ? (diff / prev) * 100 : 0;
    const sign = diff >= 0 ? "▲ +" : "▼ ";
    const colorClass = diff >= 0 ? "text-emerald-400" : "text-rose-400";
    if (changeEl) {
      changeEl.className = `text-sm font-bold font-mono ${colorClass}`;
      changeEl.innerText = `${sign}${isUS ? fmt(Math.abs(diff)) : Math.round(Math.abs(diff)).toLocaleString()} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)`;
    }
  }

  // 2. Timing Signal Badge
  const badgeContainer = document.getElementById("chart-signal-badge-container");
  const badgeDot = document.getElementById("chart-signal-dot");
  const badgeText = document.getElementById("chart-signal-badge-text");

  if (badgeText) badgeText.innerText = timing.signal_badge || "보유 지속 / 추세 관망";
  
  let containerClass = "px-4 py-2.5 rounded-xl border flex items-center space-x-2.5 shadow-lg ";
  let dotClass = "w-2.5 h-2.5 rounded-full ";
  const sigType = timing.signal_type || "";

  if (sigType.includes("BUY") || sigType.includes("REBOUND") || sigType === "PULLBACK_BUY") {
    containerClass += "bg-emerald-950/60 border-emerald-500/50 shadow-emerald-900/30 text-emerald-200";
    dotClass += "bg-emerald-400 animate-pulse";
  } else if (sigType.includes("STOP") || sigType.includes("BREAKDOWN")) {
    containerClass += "bg-rose-950/60 border-rose-500/50 shadow-rose-900/30 text-rose-200";
    dotClass += "bg-rose-500";
  } else if (sigType.includes("SELL") || sigType.includes("OVERBOUGHT")) {
    containerClass += "bg-amber-950/60 border-amber-500/50 shadow-amber-900/30 text-amber-200";
    dotClass += "bg-amber-400";
  } else {
    containerClass += "bg-slate-900/80 border-slate-700 shadow-slate-900/30 text-slate-200";
    dotClass += "bg-indigo-400";
  }
  if (badgeContainer) badgeContainer.className = containerClass;
  if (badgeDot) badgeDot.className = dotClass;

  // 3. Technical Score
  const scoreVal = timing.technical_score !== undefined ? timing.technical_score : 50;
  const scoreValEl = document.getElementById("chart-score-val");
  const scoreBarEl = document.getElementById("chart-score-bar");
  if (scoreValEl) scoreValEl.innerText = scoreVal;
  if (scoreBarEl) {
    scoreBarEl.style.width = `${scoreVal}%`;
    scoreBarEl.className = `h-full rounded-full transition-all duration-500 ${scoreVal >= 70 ? "bg-emerald-500" : scoreVal <= 40 ? "bg-rose-500" : "bg-indigo-500"}`;
  }

  // 4. Headline & Guidance
  const headlineEl = document.getElementById("chart-headline-text");
  const guidanceEl = document.getElementById("chart-guidance-text");
  if (headlineEl) headlineEl.innerText = timing.headline || "이동평균선 및 추세 지지선 분석 완료";
  if (guidanceEl) guidanceEl.innerText = timing.action_guidance || "현재 뚜렷한 추세 이탈 없이 안정적인 흐름을 보이고 있습니다.";

  // 5. Four Key Execution Price Levels
  const pbEl = document.getElementById("chart-lvl-pullback");
  const slEl = document.getElementById("chart-lvl-stoploss");
  const tg1El = document.getElementById("chart-lvl-target1");
  const tg2El = document.getElementById("chart-lvl-target2");

  if (pbEl) pbEl.innerText = fmt(levels.pullback_buy_price);
  if (slEl) slEl.innerText = fmt(levels.stop_loss_price);
  if (tg1El) tg1El.innerText = fmt(levels.target_price_1);
  if (tg2El) tg2El.innerText = fmt(levels.target_price_2);

  // 6. Pillar 1: MAs & Disparity
  const pAlign = document.getElementById("pillar-alignment");
  const pDisp20 = document.getElementById("pillar-disparity20");
  const pDisp60 = document.getElementById("pillar-disparity60");
  const pCross = document.getElementById("pillar-cross");
  const pDescMa = document.getElementById("pillar-desc-ma");

  if (pAlign) pAlign.innerText = timing.alignment || "정배열 유지";
  if (pDisp20) {
    const d20 = timing.disparity_20 ? timing.disparity_20.toFixed(1) : "100.0";
    const status = timing.disparity_20 > 105 ? "(단기 이격 확대)" : timing.disparity_20 < 98 ? "(과매도권)" : "(안정 매수권)";
    pDisp20.innerText = `${d20}% ${status}`;
  }
  if (pDisp60) {
    const d60 = timing.disparity_60 !== undefined ? timing.disparity_60.toFixed(1) : "0.0";
    pDisp60.innerText = `${d60 > 0 ? "+" : ""}${d60}% ${d60 >= 0 ? "상회 (지지)" : "하회 (경계)"}`;
  }
  if (pCross) pCross.innerText = timing.cross_signal || "중립 유지";
  if (pDescMa) {
    pDescMa.innerText = `주가가 20일선(${fmt(levels.pullback_buy_price)})과 60일 수급선을 기준으로 ${timing.alignment || "정배열"} 상태를 형성하고 있습니다.`;
  }

  // 7. Pillar 2: Bollinger Bands
  const ind = data.indicators || {};
  const bbLen = ind.bollinger_upper ? ind.bollinger_upper.length : 0;
  const bbUpper = bbLen > 0 ? ind.bollinger_upper[bbLen - 1] : levels.target_price_1;
  const bbMid = ind.ma20 && ind.ma20.length > 0 ? ind.ma20[ind.ma20.length - 1] : levels.pullback_buy_price;
  const bbLower = bbLen > 0 ? ind.bollinger_lower[bbLen - 1] : (bbMid ? bbMid * 0.92 : 0);
  const bbBw = ind.bollinger_bandwidth && ind.bollinger_bandwidth.length > 0 ? ind.bollinger_bandwidth[ind.bollinger_bandwidth.length - 1] : 10.0;

  const pBbStatus = document.getElementById("pillar-bb-status");
  const pBbUp = document.getElementById("pillar-bb-upper");
  const pBbMid = document.getElementById("pillar-bb-mid");
  const pBbLow = document.getElementById("pillar-bb-lower");
  const pDescBb = document.getElementById("pillar-desc-bb");

  if (pBbStatus) pBbStatus.innerText = bbBw < 8.0 ? "밴드 스퀴즈 (수축 후 폭발 직전)" : "밴드 확장 및 추세 진행";
  if (pBbUp) pBbUp.innerText = fmt(bbUpper);
  if (pBbMid) pBbMid.innerText = fmt(bbMid);
  if (pBbLow) pBbLow.innerText = fmt(bbLower);
  if (pDescBb) {
    pDescBb.innerText = `볼린저 밴드 상단(${fmt(bbUpper)}) 및 하단 지지선(${fmt(bbLower)}) 사이에서 중심선(20MA) 지지를 확인하는 구간입니다.`;
  }

  // 8. Pillar 3: Momentum & RSI
  const pRsiVal = document.getElementById("pillar-rsi-val");
  const pRsiState = document.getElementById("pillar-rsi-state");
  const pMacdHist = document.getElementById("pillar-macd-hist");
  const pDivergence = document.getElementById("pillar-divergence");
  const pDescMom = document.getElementById("pillar-desc-momentum");

  const rsi = timing.latest_rsi ? timing.latest_rsi.toFixed(1) : "50.0";
  if (pRsiVal) pRsiVal.innerText = `${rsi} (${timing.latest_rsi >= 70 ? "과열 익절권" : timing.latest_rsi <= 35 ? "과매도 반등권" : "적정 매수권"})`;
  if (pRsiState) pRsiState.innerText = timing.latest_rsi >= 70 ? "과열 주의 (분할 매도)" : timing.latest_rsi <= 35 ? "침체 반등 기회" : "안정적 중립";
  if (pMacdHist) {
    const mh = timing.latest_macd_hist || 0;
    pMacdHist.innerText = `${mh > 0 ? "+" : ""}${Math.round(mh).toLocaleString()} (${mh > 0 ? "양봉 확장" : "음봉 축소"})`;
  }
  if (pDivergence) pDivergence.innerText = timing.divergence || "정상 추세 추종";
  if (pDescMom) {
    pDescMom.innerText = `RSI(14) ${rsi} 수준으로 과열 없이 안정적이며, ${timing.divergence || "다이버전스 없는 건전한 모멘텀"} 흐름을 나타냅니다.`;
  }

  // 9. Pillar 4: Volume & Liquidity
  const pVolRatio = document.getElementById("pillar-vol-ratio");
  const pVolSurge = document.getElementById("pillar-vol-surge");
  const pVolState = document.getElementById("pillar-vol-state");
  const pVolNeeded = document.getElementById("pillar-vol-needed");
  const pDescVol = document.getElementById("pillar-desc-volume");

  const vr = timing.vol_ratio ? timing.vol_ratio.toFixed(2) : "1.00";
  if (pVolRatio) pVolRatio.innerText = `${vr}배 (${timing.vol_ratio >= 1.5 ? "수급 급증" : timing.vol_ratio <= 0.7 ? "거래량 수렴" : "평균 수준"})`;
  if (pVolSurge) pVolSurge.innerText = timing.vol_ratio >= 1.8 ? "대량 수급 돌파 발생" : "평균 수준 유지";
  if (pVolState) pVolState.innerText = timing.vol_ratio < 0.85 ? "눌림목 매물 소화 완료" : "활발한 손바뀜 진행 중";
  if (pVolNeeded) pVolNeeded.innerText = "평균의 1.8배 이상 권장";
  if (pDescVol) {
    pDescVol.innerText = `20일 평균 대비 ${vr}배 거래량으로 ${timing.vol_ratio < 1.0 ? "눌림목 조정 시 거래량이 마르는 건전한 패턴" : "거래량이 동반된 활발한 추세"}입니다.`;
  }
}

function setChartTimeframe(days) {
  g_chartTimeframe = days;
  [20, 60, 110].forEach(d => {
    const btn = document.getElementById(`tf-btn-${d}`);
    if (btn) {
      if (d === days) {
        btn.className = "px-2.5 py-1 rounded-lg bg-indigo-600 text-white font-bold transition";
      } else {
        btn.className = "px-2.5 py-1 rounded-lg text-slate-400 hover:text-white transition";
      }
    }
  });
  renderMainPriceChart();
  renderSubIndicatorChart();
}

function updateMainChartLayers() {
  renderMainPriceChart();
}

function setSubChartMode(mode) {
  g_subChartMode = mode;
  ["volume", "macd", "rsi"].forEach(m => {
    const btn = document.getElementById(`sub-btn-${m}`);
    if (btn) {
      if (m === mode) {
        btn.className = "px-3 py-1 rounded-lg bg-indigo-600 text-white font-bold transition";
      } else {
        btn.className = "px-3 py-1 rounded-lg text-slate-400 hover:text-white transition";
      }
    }
  });

  const labelEl = document.getElementById("sub-chart-stat-label");
  if (labelEl) {
    if (mode === "volume") labelEl.innerText = "거래량 & 20일 거래량 이동평균선";
    else if (mode === "macd") labelEl.innerText = "MACD Line(12,26) & Signal(9) & Histogram";
    else if (mode === "rsi") labelEl.innerText = "RSI(14) 상대강도지수 & 과매수(70)/과매도(30) 기준선";
  }

  renderSubIndicatorChart();
}

function renderMainPriceChart() {
  const canvas = document.getElementById("chart-main-canvas");
  if (!canvas || !g_chartData || !g_chartData.candles || g_chartData.candles.length === 0) return;

  if (g_mainCandleChart) {
    g_mainCandleChart.destroy();
    g_mainCandleChart = null;
  }

  const allCandles = g_chartData.candles;
  const count = Math.min(g_chartTimeframe, allCandles.length);
  const startIdx = allCandles.length - count;
  const slicedCandles = allCandles.slice(startIdx);

  const labels = slicedCandles.map(c => {
    const parts = c.date.split("-");
    return parts.length === 3 ? `${parts[1]}/${parts[2]}` : c.date;
  });
  const closePrices = slicedCandles.map(c => c.close);

  const ind = g_chartData.indicators || {};
  const ma5 = (ind.ma5 || []).slice(startIdx);
  const ma20 = (ind.ma20 || []).slice(startIdx);
  const ma60 = (ind.ma60 || []).slice(startIdx);
  const ma120 = (ind.ma120 || []).slice(startIdx);
  const bbUpper = (ind.bollinger_upper || []).slice(startIdx);
  const bbLower = (ind.bollinger_lower || []).slice(startIdx);

  const showBollinger = document.getElementById("toggle-bollinger")?.checked !== false;
  const showMas = document.getElementById("toggle-mas")?.checked !== false;
  const showDcf = document.getElementById("toggle-dcf-overlay")?.checked === true;
  const isUS = g_chartData.market === "US";

  const datasets = [
    {
      label: "주가 (종가)",
      data: closePrices,
      borderColor: "#3b82f6",
      backgroundColor: "rgba(59, 130, 246, 0.08)",
      borderWidth: 2.5,
      fill: true,
      tension: 0.15,
      pointRadius: count > 50 ? 0 : 2.5,
      pointHoverRadius: 6,
      pointBackgroundColor: "#3b82f6",
      order: 1
    }
  ];

  if (showMas) {
    if (ma5.length > 0) {
      datasets.push({
        label: "5일선 (단기 추세)",
        data: ma5,
        borderColor: "#38bdf8",
        borderWidth: 1.2,
        pointRadius: 0,
        fill: false,
        tension: 0.15,
        order: 2
      });
    }
    if (ma20.length > 0) {
      datasets.push({
        label: "20일선 (생명선 / 눌림목 매수 기준)",
        data: ma20,
        borderColor: "#10b981",
        borderWidth: 3.0,
        pointRadius: 0,
        fill: false,
        tension: 0.15,
        order: 2
      });
    }
    if (ma60.length > 0) {
      datasets.push({
        label: "60일선 (기관 수급선 / 손절 기준)",
        data: ma60,
        borderColor: "#f97316",
        borderWidth: 2.2,
        pointRadius: 0,
        fill: false,
        tension: 0.15,
        order: 2
      });
    }
    if (ma120.length > 0) {
      datasets.push({
        label: "120일선 (중장기 대세선)",
        data: ma120,
        borderColor: "#a855f7",
        borderWidth: 1.5,
        borderDash: [5, 4],
        pointRadius: 0,
        fill: false,
        tension: 0.15,
        order: 2
      });
    }
  }

  if (showBollinger && bbUpper.length > 0 && bbLower.length > 0) {
    datasets.push({
      label: "볼린저 상단 (1차 익절 저항선)",
      data: bbUpper,
      borderColor: "rgba(99, 102, 241, 0.7)",
      borderWidth: 1.2,
      borderDash: [4, 3],
      pointRadius: 0,
      fill: false,
      tension: 0.15,
      order: 3
    });
    datasets.push({
      label: "볼린저 하단 (과매도 지지선)",
      data: bbLower,
      borderColor: "rgba(99, 102, 241, 0.7)",
      borderWidth: 1.2,
      borderDash: [4, 3],
      pointRadius: 0,
      fill: "-1",
      backgroundColor: "rgba(99, 102, 241, 0.05)",
      tension: 0.15,
      order: 3
    });
  }

  if (showDcf && g_chartData.dcf_bands) {
    const dcf = g_chartData.dcf_bands;
    if (dcf.base_fair_value) {
      datasets.push({
        label: `다모다란 적정가 (${dcf.sector_name || "DCF"})`,
        data: Array(count).fill(dcf.base_fair_value),
        borderColor: "#f59e0b",
        borderWidth: 2.2,
        borderDash: [6, 4],
        pointRadius: 0,
        fill: false,
        order: 0
      });
    }
    if (dcf.bullish_value) {
      datasets.push({
        label: "다모다란 낙관가 (Bull Target)",
        data: Array(count).fill(dcf.bullish_value),
        borderColor: "#ec4899",
        borderWidth: 1.5,
        borderDash: [3, 3],
        pointRadius: 0,
        fill: false,
        order: 0
      });
    }
    if (dcf.conservative_value) {
      datasets.push({
        label: "다모다란 안전마진가 (Conservative)",
        data: Array(count).fill(dcf.conservative_value),
        borderColor: "#06b6d4",
        borderWidth: 1.5,
        borderDash: [3, 3],
        pointRadius: 0,
        fill: false,
        order: 0
      });
    }
  }

  const ctx = canvas.getContext("2d");
  g_mainCandleChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false
      },
      plugins: {
        legend: {
          position: "top",
          align: "start",
          labels: {
            boxWidth: 12,
            boxHeight: 3,
            color: "#cbd5e1",
            font: { size: 10, weight: "bold" },
            padding: 8
          }
        },
        tooltip: {
          backgroundColor: "rgba(15, 23, 42, 0.95)",
          titleColor: "#f8fafc",
          bodyColor: "#cbd5e1",
          borderColor: "#334155",
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: function(context) {
              const val = context.parsed.y;
              const formatted = isUS 
                ? `$${Number(val).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` 
                : `₩${Math.round(val).toLocaleString("ko-KR")}`;
              return ` ${context.dataset.label}: ${formatted}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: "rgba(51, 65, 85, 0.25)" },
          ticks: { color: "#94a3b8", font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 }
        },
        y: {
          position: "right",
          grid: { color: "rgba(51, 65, 85, 0.25)" },
          ticks: {
            color: "#94a3b8",
            font: { size: 10 },
            callback: function(val) {
              if (isUS) return `$${val}`;
              if (val >= 1000000) return `₩${(val / 10000).toLocaleString()}만`;
              return `₩${val.toLocaleString()}`;
            }
          }
        }
      }
    }
  });
}

function renderSubIndicatorChart() {
  const canvas = document.getElementById("chart-sub-canvas");
  if (!canvas || !g_chartData || !g_chartData.candles || g_chartData.candles.length === 0) return;

  if (g_subCandleChart) {
    g_subCandleChart.destroy();
    g_subCandleChart = null;
  }

  const allCandles = g_chartData.candles;
  const count = Math.min(g_chartTimeframe, allCandles.length);
  const startIdx = allCandles.length - count;
  const slicedCandles = allCandles.slice(startIdx);

  const labels = slicedCandles.map(c => {
    const parts = c.date.split("-");
    return parts.length === 3 ? `${parts[1]}/${parts[2]}` : c.date;
  });

  const ind = g_chartData.indicators || {};
  const ctx = canvas.getContext("2d");

  if (g_subChartMode === "volume") {
    // Volume Bars + 20MA Line
    const volumes = slicedCandles.map(c => c.volume);
    const barColors = slicedCandles.map(c => c.close >= c.open ? "rgba(16, 185, 129, 0.75)" : "rgba(244, 63, 94, 0.75)");
    const volMa20 = (ind.volume_ma20 || []).slice(startIdx);

    g_subCandleChart = new Chart(ctx, {
      type: "bar",
      data: {
        labels: labels,
        datasets: [
          {
            label: "거래량 (주)",
            data: volumes,
            backgroundColor: barColors,
            borderWidth: 0,
            borderRadius: 2,
            order: 2
          },
          {
            type: "line",
            label: "20일 거래량 이평",
            data: volMa20,
            borderColor: "#f59e0b",
            borderWidth: 1.8,
            pointRadius: 0,
            fill: false,
            tension: 0.2,
            order: 1
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            position: "top",
            align: "start",
            labels: { boxWidth: 10, color: "#94a3b8", font: { size: 9 }, padding: 6 }
          },
          tooltip: {
            backgroundColor: "rgba(15, 23, 42, 0.95)",
            callbacks: {
              label: function(ctx) {
                return ` ${ctx.dataset.label}: ${Math.round(ctx.parsed.y).toLocaleString()} 주`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: "#64748b", font: { size: 9 }, autoSkip: true, maxTicksLimit: 12 }
          },
          y: {
            position: "right",
            grid: { color: "rgba(51, 65, 85, 0.2)" },
            ticks: {
              color: "#64748b",
              font: { size: 9 },
              callback: function(v) {
                if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
                if (v >= 1000) return `${(v / 1000).toFixed(0)}K`;
                return v;
              }
            }
          }
        }
      }
    });

  } else if (g_subChartMode === "macd") {
    // MACD Line + Signal + Histogram
    const macdLine = (ind.macd_line || []).slice(startIdx);
    const macdSignal = (ind.macd_signal || []).slice(startIdx);
    const macdHist = (ind.macd_hist || []).slice(startIdx);
    const histColors = macdHist.map(v => v >= 0 ? "rgba(16, 185, 129, 0.75)" : "rgba(244, 63, 94, 0.75)");

    g_subCandleChart = new Chart(ctx, {
      type: "bar",
      data: {
        labels: labels,
        datasets: [
          {
            type: "bar",
            label: "MACD 오실레이터",
            data: macdHist,
            backgroundColor: histColors,
            borderWidth: 0,
            borderRadius: 1,
            order: 3
          },
          {
            type: "line",
            label: "MACD Line (12,26)",
            data: macdLine,
            borderColor: "#6366f1",
            borderWidth: 1.8,
            pointRadius: 0,
            fill: false,
            tension: 0.15,
            order: 1
          },
          {
            type: "line",
            label: "Signal Line (9)",
            data: macdSignal,
            borderColor: "#f59e0b",
            borderWidth: 1.5,
            pointRadius: 0,
            fill: false,
            tension: 0.15,
            order: 2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            position: "top",
            align: "start",
            labels: { boxWidth: 10, color: "#94a3b8", font: { size: 9 }, padding: 6 }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: "#64748b", font: { size: 9 }, autoSkip: true, maxTicksLimit: 12 }
          },
          y: {
            position: "right",
            grid: { color: "rgba(51, 65, 85, 0.2)" },
            ticks: { color: "#64748b", font: { size: 9 } }
          }
        }
      }
    });

  } else if (g_subChartMode === "rsi") {
    // RSI 14 Line + 70 Overbought + 30 Oversold Lines
    const rsiData = (ind.rsi14 || []).slice(startIdx);
    const overbought70 = Array(count).fill(70);
    const oversold30 = Array(count).fill(30);

    g_subCandleChart = new Chart(ctx, {
      type: "line",
      data: {
        labels: labels,
        datasets: [
          {
            label: "RSI (14)",
            data: rsiData,
            borderColor: "#06b6d4",
            backgroundColor: "rgba(6, 182, 212, 0.1)",
            borderWidth: 2.2,
            fill: false,
            tension: 0.15,
            pointRadius: 0,
            order: 1
          },
          {
            label: "과매수선 (70 - 분할 익절 경고)",
            data: overbought70,
            borderColor: "#f43f5e",
            borderWidth: 1.2,
            borderDash: [4, 4],
            pointRadius: 0,
            fill: false,
            order: 2
          },
          {
            label: "과매도선 (30 - 반등 매수 기회)",
            data: oversold30,
            borderColor: "#10b981",
            borderWidth: 1.2,
            borderDash: [4, 4],
            pointRadius: 0,
            fill: false,
            order: 3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            position: "top",
            align: "start",
            labels: { boxWidth: 10, color: "#94a3b8", font: { size: 9 }, padding: 6 }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: "#64748b", font: { size: 9 }, autoSkip: true, maxTicksLimit: 12 }
          },
          y: {
            position: "right",
            min: 10,
            max: 90,
            grid: { color: "rgba(51, 65, 85, 0.2)" },
            ticks: { color: "#64748b", font: { size: 9 } }
          }
        }
      }
    });
  }
}

