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
      Accept: "application/json"
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

function getQueueName(queueId) {
  const queueNames = {
    0: "커스텀",
    420: "솔로랭크",
    430: "일반",
    440: "자유랭크",
    450: "칼바람 나락",
    490: "빠른 대전",
    700: "격전",
    830: "AI 상대",
    840: "AI 상대",
    850: "AI 상대",
    1020: "단일 챔피언",
    1400: "궁극기 주문서",
    1710: "아레나"
  };

  return queueNames[queueId] || `게임 (${queueId})`;
}

function getPositionName(position) {
  const positions = {
    TOP: "탑",
    JUNGLE: "정글",
    MIDDLE: "미드",
    BOTTOM: "바텀",
    UTILITY: "서폿",
    SUPPORT: "서폿",
    "": "포지션 미상"
  };
  return positions[position] || position || "포지션 미상";
}

function getPlayerTitle(player, teamKills) {
  const kills = Number(player.kills) || 0;
  const deaths = Number(player.deaths) || 0;
  const assists = Number(player.assists) || 0;
  const cs = Number(player.totalCs) || 0;
  const durationMinutes = Math.max((Number(player.gameDuration) || 0) / 60, 1);
  const csPerMinute = cs / durationMinutes;
  const killParticipation = teamKills > 0 ? (kills + assists) / teamKills : 0;

  if (kills >= 8) return "캐리 기여형";
  if (killParticipation >= 0.7 && assists >= 6) return "교전 설계자";
  if (csPerMinute >= 7.5 && deaths <= 4) return "성장 집착형";
  if (assists >= 10) return "팀플레이형";
  if (deaths <= 2) return "안정형 플레이어";
  return "균형형 플레이어";
}

function getParticipantStats(match, puuid) {
  const participant = match?.info?.participants?.find(
    (player) => player.puuid === puuid
  );

  if (!participant) return null;

  const totalCs =
    (Number(participant.totalMinionsKilled) || 0) +
    (Number(participant.neutralMinionsKilled) || 0);

  return {
    matchId: match.metadata?.matchId || "",
    gameCreation: match.info.gameCreation,
    gameDuration: match.info.gameDuration,
    gameMode: match.info.gameMode,
    queueId: match.info.queueId,
    queueName: getQueueName(match.info.queueId),
    championId: participant.championId,
    championName: participant.championName,
    kills: participant.kills,
    deaths: participant.deaths,
    assists: participant.assists,
    win: participant.win,
    teamPosition: participant.teamPosition || participant.lane || "",
    totalCs,
    csPerMinute:
      match.info.gameDuration > 0
        ? Number((totalCs / (match.info.gameDuration / 60)).toFixed(1))
        : 0,
    summoner1Id: participant.summoner1Id,
    summoner2Id: participant.summoner2Id,
    items: [
      participant.item0,
      participant.item1,
      participant.item2,
      participant.item3,
      participant.item4,
      participant.item5,
      participant.item6
    ]
  };
}

const soloRankCache = new Map();

const TIER_SCORE = {
  IRON: 0,
  BRONZE: 2,
  SILVER: 4,
  GOLD: 6,
  PLATINUM: 8,
  EMERALD: 10,
  DIAMOND: 12,
  MASTER: 14,
  GRANDMASTER: 15.5,
  CHALLENGER: 17
};

const DIVISION_BONUS = {
  I: 0.75,
  II: 0.5,
  III: 0.25,
  IV: 0
};

function rankScore(tier, rank) {
  const base = TIER_SCORE[String(tier || '').toUpperCase()];
  if (typeof base !== 'number') return null;
  return Number((base + (DIVISION_BONUS[String(rank || '').toUpperCase()] || 0)).toFixed(2));
}

function rankLabel(entry) {
  if (!entry) return '언랭크';
  const tier = String(entry.tier || '').trim();
  const division = String(entry.rank || '').trim();
  return `${tier}${division ? ` ${division}` : ''}`.trim();
}

async function getSoloRankByPuuid(puuid) {
  if (!puuid) return null;
  if (soloRankCache.has(puuid)) return soloRankCache.get(puuid);

  try {
    const leagueUrl =
      `https://${PLATFORM_REGION}/lol/league/v4/entries/by-puuid/` +
      encodeURIComponent(puuid);
    const entries = await riotFetch(leagueUrl);
    const solo = (entries || []).find((entry) => entry.queueType === 'RANKED_SOLO_5x5');
    const result = solo ? {
      tier: solo.tier,
      rank: solo.rank,
      leaguePoints: solo.leaguePoints,
      wins: solo.wins,
      losses: solo.losses,
      label: rankLabel(solo),
      score: rankScore(solo.tier, solo.rank)
    } : null;
    soloRankCache.set(puuid, result);
    return result;
  } catch (error) {
    console.error(`랭크 조회 실패 (${puuid}):`, error.message);
    soloRankCache.set(puuid, null);
    return null;
  }
}

function calculateTeamStrength(team) {
  const ranked = (team || []).filter((player) => typeof player.rankScore === 'number');
  const avgScore = ranked.length
    ? ranked.reduce((sum, player) => sum + player.rankScore, 0) / ranked.length
    : null;

  return {
    avgScore: avgScore === null ? null : Number(avgScore.toFixed(2)),
    rankedPlayers: ranked.length,
    totalPlayers: (team || []).length,
    rankCoverage: (team || []).length
      ? Math.round((ranked.length / team.length) * 100)
      : 0
  };
}

function calculateWinEstimate(myTeam, enemyTeam) {
  const my = calculateTeamStrength(myTeam);
  const enemy = calculateTeamStrength(enemyTeam);

  if (my.avgScore === null || enemy.avgScore === null) {
    return {
      available: false,
      myWinRate: 50,
      enemyWinRate: 50,
      difference: null,
      myStrength: my,
      enemyStrength: enemy,
      note: '두 팀의 랭크 정보를 충분히 확인하지 못해 50:50으로 표시합니다.'
    };
  }

  // 프로토타입용 단순 랭크 전력 모델:
  // 평균 랭크 점수 차이 1당 약 3%p를 가산하며 20~80% 사이로 제한합니다.
  // 실제 경기 승률을 의미하지 않으며, 랭크만으로 계산한 추정치입니다.
  const difference = my.avgScore - enemy.avgScore;
  const myWinRate = Math.round(Math.max(20, Math.min(80, 50 + difference * 3)));

  return {
    available: true,
    myWinRate,
    enemyWinRate: 100 - myWinRate,
    difference: Number(difference.toFixed(2)),
    myStrength: my,
    enemyStrength: enemy,
    note: '현재 솔로랭크를 기반으로 한 프로토타입 전력 추정치입니다. 실제 승부 확률이나 공식 Riot 수치가 아닙니다.'
  };
}

function getTeamProfile(players) {
  const games = players.length || 1;
  const totalKills = players.reduce((sum, p) => sum + (Number(p.kills) || 0), 0);
  const avgCsPerMin = players.reduce((sum, p) => sum + (Number(p.csPerMinute) || 0), 0) / games;
  const avgDeaths = players.reduce((sum, p) => sum + (Number(p.deaths) || 0), 0) / games;
  const avgKillParticipation = players.reduce((sum, p) => {
    const kp = totalKills > 0 ? ((Number(p.kills) || 0) + (Number(p.assists) || 0)) / totalKills : 0;
    return sum + kp;
  }, 0) / games;

  let profile = "균형형 팀";
  if (avgKillParticipation >= 0.68) profile = "교전 중심 팀";
  else if (avgCsPerMin >= 7.2) profile = "성장 중심 팀";
  else if (avgDeaths <= 3.2) profile = "안정 운영형 팀";

  return {
    avgCsPerMin: Number(avgCsPerMin.toFixed(1)),
    avgDeaths: Number(avgDeaths.toFixed(1)),
    avgKillParticipation: Number((avgKillParticipation * 100).toFixed(0)),
    totalKills,
    profile
  };
}

function makeTeamTip(myTeam, enemyTeam) {
  const my = getTeamProfile(myTeam);
  const enemy = getTeamProfile(enemyTeam);
  const tips = [];

  if (my.avgCsPerMin > enemy.avgCsPerMin + 0.6) {
    tips.push("우리 팀은 평균 CS/min이 더 높아 성장 중심 성향이 보입니다.");
  } else if (enemy.avgCsPerMin > my.avgCsPerMin + 0.6) {
    tips.push("상대 팀은 평균 CS/min이 더 높아 성장 중심 성향이 보입니다.");
  } else {
    tips.push("양 팀의 평균 CS/min 차이가 크지 않아 성장 지표는 비슷합니다.");
  }

  if (my.avgKillParticipation > enemy.avgKillParticipation + 7) {
    tips.push("우리 팀은 선택 경기에서 교전 참여 비율이 더 높았습니다.");
  } else if (enemy.avgKillParticipation > my.avgKillParticipation + 7) {
    tips.push("상대 팀은 선택 경기에서 교전 참여 비율이 더 높았습니다.");
  } else {
    tips.push("양 팀의 교전 참여 비율이 비슷하게 나타났습니다.");
  }

  tips.push("아래 수치는 선택한 종료 경기의 데이터를 바탕으로 한 복기용 분석입니다.");
  return tips;
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

    const accountUrl =
      `https://${ACCOUNT_REGION}/riot/account/v1/accounts/by-riot-id/` +
      `${encodeURIComponent(parsed.gameName)}/${encodeURIComponent(parsed.tagLine)}`;

    const account = await riotFetch(accountUrl);

    const summonerUrl =
      `https://${PLATFORM_REGION}/lol/summoner/v4/summoners/by-puuid/` +
      encodeURIComponent(account.puuid);

    const summoner = await riotFetch(summonerUrl);

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

    const matchIdsUrl =
      `https://${ACCOUNT_REGION}/lol/match/v5/matches/by-puuid/` +
      `${encodeURIComponent(account.puuid)}/ids?start=0&count=10`;

    const matchIds = await riotFetch(matchIdsUrl);
    const matches = [];

    for (const matchId of matchIds) {
      try {
        const match = await riotFetch(
          `https://${ACCOUNT_REGION}/lol/match/v5/matches/${encodeURIComponent(matchId)}`
        );
        const stats = getParticipantStats(match, account.puuid);
        if (stats) matches.push(stats);
      } catch (matchError) {
        console.error(`매치 ${matchId} 조회 실패:`, matchError.message);
      }
    }

    res.json({
      riotId: `${account.gameName}#${account.tagLine}`,
      gameName: account.gameName,
      tagLine: account.tagLine,
      puuid: account.puuid,
      profileIconId: summoner.profileIconId,
      summonerLevel: summoner.summonerLevel,
      ranks,
      matches
    });
  } catch (error) {
    console.error(error);

    if (error.status === 404) {
      return res.status(404).json({
        message: "해당 Riot ID의 플레이어를 찾을 수 없습니다."
      });
    }

    if (error.status === 403 || error.status === 401) {
      return res.status(error.status).json({
        message: "Riot API 인증이 거부되었습니다. .env의 API Key와 현재 활성 상태를 확인해주세요."
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

// 종료된 경기 하나를 선택하여 5v5 복기 데이터를 반환합니다.
// 실시간 게임 스카우팅용이 아니라 선택한 경기의 match-v5 기록을 분석합니다.
app.get("/api/team", async (req, res) => {
  try {
    const matchId = String(req.query.matchId || "").trim();
    const playerPuuid = String(req.query.puuid || "").trim();

    if (!matchId) {
      return res.status(400).json({ message: "matchId가 필요합니다." });
    }

    const match = await riotFetch(
      `https://${ACCOUNT_REGION}/lol/match/v5/matches/${encodeURIComponent(matchId)}`
    );

    const participants = match?.info?.participants || [];
    if (participants.length !== 10) {
      return res.status(400).json({
        message: "선택한 경기의 참가자 데이터를 충분히 가져오지 못했습니다."
      });
    }

    const playerTeamId = playerPuuid
      ? participants.find((p) => p.puuid === playerPuuid)?.teamId
      : participants[0]?.teamId;

    if (!playerTeamId) {
      return res.status(400).json({
        message: "검색한 플레이어가 선택한 경기에서 확인되지 않습니다."
      });
    }

    const byTeam = new Map();
    for (const participant of participants) {
      if (!byTeam.has(participant.teamId)) byTeam.set(participant.teamId, []);
    }

    const base = participants.map((participant) => ({
      puuid: participant.puuid,
      riotId: participant.riotId
        || `${participant.riotIdGameName || participant.summonerName || "Unknown"}#${participant.riotIdTagline || ""}`.replace(/#$/, ""),
      gameName: participant.riotIdGameName || participant.summonerName || "Unknown",
      championId: participant.championId,
      championName: participant.championName,
      teamId: participant.teamId,
      teamPosition: getPositionName(participant.teamPosition || participant.lane || ""),
      kills: Number(participant.kills) || 0,
      deaths: Number(participant.deaths) || 0,
      assists: Number(participant.assists) || 0,
      win: participant.win,
      totalCs: (Number(participant.totalMinionsKilled) || 0) + (Number(participant.neutralMinionsKilled) || 0),
      csPerMinute: match.info.gameDuration > 0
        ? Number(((
            (Number(participant.totalMinionsKilled) || 0) +
            (Number(participant.neutralMinionsKilled) || 0)
          ) / (match.info.gameDuration / 60)).toFixed(1))
        : 0,
      gameDuration: match.info.gameDuration
    }));

    const teamKills = new Map();
    for (const p of base) {
      teamKills.set(p.teamId, (teamKills.get(p.teamId) || 0) + p.kills);
    }

    for (const p of base) {
      p.killParticipation = teamKills.get(p.teamId) > 0
        ? Number((((p.kills + p.assists) / teamKills.get(p.teamId)) * 100).toFixed(0))
        : 0;
      p.title = getPlayerTitle(p, teamKills.get(p.teamId) || 0);
      byTeam.get(p.teamId).push(p);
    }

    const myTeam = byTeam.get(playerTeamId) || [];
    const enemyTeam = [...byTeam.entries()].find(([teamId]) => teamId !== playerTeamId)?.[1] || [];

    // 선택 경기의 10명에 대해 현재 솔로랭크를 조회합니다.
    // 실시간 경기 데이터가 아니라 종료된 경기 복기 화면에서만 사용합니다.
    const rankResults = await Promise.all(
      base.map((player) => getSoloRankByPuuid(player.puuid))
    );

    base.forEach((player, index) => {
      const rank = rankResults[index];
      player.rankLabel = rank?.label || '언랭크';
      player.rankTier = rank?.tier || '';
      player.rankDivision = rank?.rank || '';
      player.rankLeaguePoints = rank?.leaguePoints ?? null;
      player.rankWins = rank?.wins ?? null;
      player.rankLosses = rank?.losses ?? null;
      player.rankScore = rank?.score ?? null;
    });

    const teamInfo = match.info.teams || [];
    const getTeamObjectives = (teamId) => {
      const info = teamInfo.find((team) => team.teamId === teamId);
      return {
        baron: info?.objectives?.baron?.kills || 0,
        dragon: info?.objectives?.dragon?.kills || 0,
        tower: info?.objectives?.tower?.kills || 0,
        inhibitor: info?.objectives?.inhibitor?.kills || 0
      };
    };

    res.json({
      matchId,
      gameCreation: match.info.gameCreation,
      gameDuration: match.info.gameDuration,
      queueName: getQueueName(match.info.queueId),
      myTeam,
      enemyTeam,
      myProfile: getTeamProfile(myTeam),
      enemyProfile: getTeamProfile(enemyTeam),
      winEstimate: calculateWinEstimate(myTeam, enemyTeam),
      myObjectives: getTeamObjectives(playerTeamId),
      enemyObjectives: getTeamObjectives(enemyTeam[0]?.teamId),
      tips: makeTeamTip(myTeam, enemyTeam)
    });
  } catch (error) {
    console.error(error);

    if (error.status === 404) {
      return res.status(404).json({ message: "선택한 경기를 찾을 수 없습니다." });
    }

    if (error.status === 401 || error.status === 403) {
      return res.status(error.status).json({
        message: "Riot API 인증이 거부되었습니다. API Key를 확인해주세요."
      });
    }

    if (error.status === 429) {
      return res.status(429).json({
        message: "Riot API 요청 제한에 도달했습니다. 잠시 후 다시 시도해주세요."
      });
    }

    res.status(500).json({ message: error.message || "팀 분석 중 오류가 발생했습니다." });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "Main.html"));
});

app.listen(PORT, () => {
  console.log(`서버 실행: http://localhost:${PORT}`);
});
