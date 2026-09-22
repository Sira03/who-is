require("dotenv").config();

const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const RIOT_API_KEY = process.env.RIOT_API_KEY;

if (!RIOT_API_KEY) {
  console.error("RIOT_API_KEY가 .env에 설정되지 않았습니다.");
  process.exit(1);
}

const ACCOUNT_REGION = "asia.api.riotgames.com";
const PLATFORM_REGION = "kr.api.riotgames.com";

async function riotFetch(url) {
  const response = await fetch(url, {
    headers: {
      "X-Riot-Token": RIOT_API_KEY,
      "Accept": "application/json"
    }
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    // Riot API가 JSON이 아닌 응답을 보내는 경우
  }

  if (!response.ok) {
    const error = new Error(
      data?.status?.message || `Riot API 오류 (${response.status})`
    );
    error.status = response.status;
    throw error;
  }

  return data;
}

function parseRiotId(riotId) {
  const value = String(riotId || "").trim();
  const separatorIndex = value.lastIndexOf("#");

  if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
    return null;
  }

  return {
    gameName: value.slice(0, separatorIndex).trim(),
    tagLine: value.slice(separatorIndex + 1).trim()
  };
}

app.use(express.static(__dirname));

app.get("/api/player", async (req, res) => {
  try {
    const parsed = parseRiotId(req.query.riotId);

    if (!parsed) {
      return res.status(400).json({
        message: "Riot ID를 gameName#tagLine 형식으로 입력해주세요."
      });
    }

    // 1. Riot ID -> PUUID
    const accountUrl =
      `https://${ACCOUNT_REGION}/riot/account/v1/accounts/by-riot-id/` +
      `${encodeURIComponent(parsed.gameName)}/${encodeURIComponent(parsed.tagLine)}`;

    const account = await riotFetch(accountUrl);

    // 2. PUUID -> 소환사 정보
    const summonerUrl =
      `https://${PLATFORM_REGION}/lol/summoner/v4/summoners/by-puuid/` +
      encodeURIComponent(account.puuid);

    const summoner = await riotFetch(summonerUrl);

    // 3. PUUID -> 랭크 정보
    const leagueUrl =
      `https://${PLATFORM_REGION}/lol/league/v4/entries/by-puuid/` +
      encodeURIComponent(account.puuid);

    const leagueEntries = await riotFetch(leagueUrl);

    const ranks = leagueEntries.map((entry) => ({
      queueType: entry.queueType,
      tier: entry.tier,
      rank: entry.rank,
      leaguePoints: entry.leaguePoints,
      wins: entry.wins,
      losses: entry.losses
    }));

    res.json({
      riotId: `${account.gameName}#${account.tagLine}`,
      gameName: account.gameName,
      tagLine: account.tagLine,
      puuid: account.puuid,
      profileIconId: summoner.profileIconId,
      summonerLevel: summoner.summonerLevel,
      ranks
    });
  } catch (error) {
    console.error(error);

    if (error.status === 404) {
      return res.status(404).json({
        message: "해당 Riot ID의 플레이어를 찾을 수 없습니다."
      });
    }

    if (error.status === 403) {
      return res.status(403).json({
        message: "Riot API Key가 유효하지 않거나 사용할 수 없습니다."
      });
    }

    if (error.status === 429) {
      return res.status(429).json({
        message: "Riot API 요청 제한에 도달했습니다. 잠시 후 다시 시도해주세요."
      });
    }

    res.status(500).json({
      message: error.message || "Riot API 요청 중 오류가 발생했습니다."
    });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, 'Main.html'));
});

app.listen(PORT, () => {
  console.log(`서버 실행: http://localhost:${PORT}`);
});
