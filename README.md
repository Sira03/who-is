# Who Is... Riot API + Node.js

## 1. 준비
- Node.js 설치
- Riot Developer Portal에서 Riot API Key 발급

## 2. 설치
이 폴더에서 터미널을 열고:

```bash
npm install
```

## 3. API Key 설정
`.env.example`을 복사해서 `.env`를 만들고 Riot API Key를 입력합니다.

```env
RIOT_API_KEY=RGAPI-실제키
PORT=3000
```

## 4. 실행

```bash
npm start
```

브라우저에서:

http://localhost:3000

## 주의
Riot API Key를 Main.html 같은 프론트엔드 파일에 직접 넣지 마세요.
`.env`는 GitHub 등에 공개하지 않는 것이 좋습니다.
