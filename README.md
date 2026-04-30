# OJT 업무 매뉴얼 시스템 v3.0

> 스태핑서비스팀 · 경영지원팀 공용 업무 매뉴얼 시스템  
> 여러 사용자가 동일한 데이터를 조회하고, 관리자 수정이 전 사용자에게 즉시 반영되는 서버 기반 시스템입니다.

---

## 📁 프로젝트 구조

```
ojt-manual-system/
├─ frontend/
│  ├─ index.html       # SPA 메인 화면
│  ├─ style.css        # 전체 스타일
│  └─ app.js           # 클라이언트 앱 로직 (API 통신)
├─ backend/
│  ├─ server.js        # Express 서버 + REST API
│  └─ setup.js         # 초기 데이터 설정 스크립트
├─ data/
│  ├─ database.json    # 전체 매뉴얼 데이터 (자동 생성)
│  └─ users.json       # 사용자 계정 (자동 생성)
├─ package.json
├─ .env                # 환경 변수 (자동 생성)
└─ README.md
```

---

## 🚀 설치 및 실행

### 1단계 — 의존성 설치

```bash
npm install
```

### 2단계 — 초기 데이터 설정 (최초 1회)

```bash
node backend/setup.js
```

이 명령으로 생성됩니다:
- `data/database.json` — 기본 27개 업무 데이터
- `data/users.json` — 초기 3개 계정
- `.env` — 환경 변수 파일

### 3단계 — 서버 실행

```bash
npm start
```

개발 모드 (파일 변경 시 자동 재시작):
```bash
npm run dev
```

---

## 🌐 접속 방법

### 로컬 접속
```
http://localhost:3000
```

### 같은 네트워크 내 다른 PC에서 접속
1. 서버 PC의 IP 주소 확인:
   - Windows: `ipconfig` → IPv4 주소
   - Mac/Linux: `ifconfig` 또는 `ip addr`
2. 다른 PC 브라우저에서 접속:
   ```
   http://[서버IP주소]:3000
   ```
   예: `http://192.168.1.100:3000`

---

## 🔑 초기 계정 정보

| ID | 비밀번호 | 권한 |
|---|---|---|
| admin | admin1234 | 관리자 (전체 편집) |
| staffing | staffing1234 | 스태핑서비스팀 |
| mgmt | mgmt1234 | 경영지원팀 |

> ⚠️ **보안**: 운영 전 반드시 비밀번호를 변경하세요!  
> 로그인 후 우측 상단 이름 클릭 → 비밀번호 변경

---

## 🔐 보안 설정

`.env` 파일에서 JWT 시크릿을 반드시 변경하세요:

```env
JWT_SECRET=여기에-복잡한-랜덤-문자열-입력
JWT_EXPIRES_IN=24h
PORT=3000
```

---

## 💾 데이터 저장 위치

| 파일 | 내용 |
|---|---|
| `data/database.json` | 업무 매뉴얼 전체 데이터 |
| `data/users.json` | 사용자 계정 및 비밀번호 해시 |

---

## 🔄 백업 방법

### 방법 1 — API를 통한 JSON 다운로드 (관리자)
브라우저에서 로그인 후:
```
http://localhost:3000/api/backup
```
`ojt-backup-[날짜].json` 파일로 다운로드됩니다.

### 방법 2 — 파일 직접 복사
```bash
cp data/database.json data/database.backup-$(date +%Y%m%d).json
```

### 방법 3 — 정기 자동 백업 (cron)
```bash
# crontab -e 에 추가 (매일 오전 2시 백업)
0 2 * * * cp /path/to/ojt-system/data/database.json /path/to/backups/database-$(date +\%Y\%m\%d).json
```

---

## 🌍 외부 서버 배포 방법

### PM2로 프로세스 관리 (권장)

```bash
# PM2 설치
npm install -g pm2

# 서버 시작
pm2 start backend/server.js --name ojt-manual

# 시스템 재부팅 시 자동 시작
pm2 startup
pm2 save
```

### 포트 변경 (80포트 사용 시)
`.env`에서:
```env
PORT=80
```

---

## 📋 API 엔드포인트

### 인증
| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | /api/auth/login | 로그인 |
| GET | /api/auth/me | 현재 사용자 |
| POST | /api/auth/logout | 로그아웃 |
| POST | /api/auth/change-password | 비밀번호 변경 |
| POST | /api/auth/reset-password | 비밀번호 초기화 (관리자) |
| GET | /api/auth/users | 사용자 목록 (관리자) |

### 데이터
| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | /api/data | 전체 데이터 조회 |
| GET | /api/tasks | 업무 목록 |
| POST | /api/tasks | 업무 추가 |
| PUT | /api/tasks/:id | 업무 수정 |
| DELETE | /api/tasks/:id | 업무 삭제 |
| POST | /api/tasks/:id/procedures | 처리절차 추가 |
| PUT | /api/tasks/:id/procedures/:pid | 처리절차 매뉴얼 저장 |
| GET | /api/history | 히스토리 목록 |
| POST | /api/history | 히스토리 등록 |
| PUT | /api/history/:id | 히스토리 수정 |
| DELETE | /api/history/:id | 히스토리 삭제 |
| GET | /api/glossary | 용어사전 |
| POST | /api/glossary | 용어 추가 (관리자) |
| PUT | /api/glossary/:id | 용어 수정 (관리자) |
| DELETE | /api/glossary/:id | 용어 삭제 (관리자) |
| GET | /api/logs | 수정 이력 (관리자) |
| POST | /api/chat-logs | 챗봇 로그 저장 |
| GET | /api/chat-logs | 챗봇 로그 조회 (관리자) |
| GET | /api/backup | 백업 다운로드 (관리자) |
| POST | /api/restore | 백업 복원 (관리자) |

---

## ⚡ 권한 구조

| 기능 | 관리자 | 스태핑서비스팀 | 경영지원팀 |
|---|---|---|---|
| 전체 조회 | ✅ | ✅ | ✅ |
| 스태핑 업무 편집 | ✅ | ✅ | ❌ |
| 경영지원 업무 편집 | ✅ | ❌ | ✅ |
| 공동업무 편집 | ✅ | 부분 | 부분 |
| 용어사전 편집 | ✅ | ❌ | ❌ |
| 수정 이력 조회 | ✅ | ❌ | ❌ |
| AI 챗봇 검색 | ✅ | ✅ | ✅ |
| 비밀번호 변경 | ✅ | ✅ | ✅ |
| 비밀번호 초기화 | ✅ | ❌ | ❌ |

---

## 🛠️ 문제 해결

### 포트 이미 사용 중
```bash
# 사용 중인 프로세스 확인
lsof -i :3000
# 종료 후 재시작
kill -9 [PID]
npm start
```

### data 폴더가 없음
```bash
node backend/setup.js
```

### 로그인이 안 됨
`data/users.json`이 없으면 setup을 재실행하세요:
```bash
# users.json만 삭제 후 재생성
rm data/users.json
node backend/setup.js
```

---

## 📝 라이센스
사내 내부용 시스템
