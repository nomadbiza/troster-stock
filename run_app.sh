#!/usr/bin/env bash
# 다모다란 밸류에이션 & 엑시트 타이밍 나침반 실행 스크립트
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

PORT=${1:-8890}
echo "========================================================"
echo "  다모다란 밸류에이션 & 매도 타이밍 예측 웹 앱 시작"
echo "  접속 주소: http://localhost:$PORT"
echo "========================================================"

python3 server.py "$PORT"
