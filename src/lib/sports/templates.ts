import { sportsNowDay } from "./rules.ts";
export function agendaExample(now = new Date()) {
  const date = sportsNowDay(new Date(now.getTime() + 7 * 86400000));
  const checkedAt = now.toISOString();
  return {
    schemaVersion: 1,
    status: "example",
    checkedAt,
    timezone: "America/Argentina/Buenos_Aires",
    curation: {
      completeHorizon: {
        river: { from: sportsNowDay(now), through: date, complete: true },
        ufc: { from: sportsNowDay(now), through: date, complete: true },
      },
    },
    events: [
      {
        kind: "football_match",
        sourceProvider: "espn",
        externalReference: "123456",
        source: { primary: "https://www.espn.com", checkedAt },
        title: "River Plate vs Rival de ejemplo",
        firstParticipant: "River Plate",
        secondParticipant: "Rival de ejemplo",
        competition: "Torneo de ejemplo",
        eventDate: date,
        startTime: "20:00",
        status: "scheduled",
        venue: "Estadio de ejemplo",
        channel: null,
        result: null,
      },
      {
        kind: "ufc_card",
        sourceProvider: "ufc_official",
        externalReference: "ufc-example",
        source: {
          primary: "https://www.ufc.com/events",
          checkedAt,
          validation: {
            officialCardComplete: true,
            officialFightCount: 2,
            independentCrossCheck: "pending",
          },
        },
        title: "UFC: Ejemplo Uno vs Ejemplo Dos",
        eventDate: date,
        preliminaryDate: date,
        preliminaryTime: "18:00",
        mainCardDate: date,
        mainCardTime: "21:00",
        venue: "Recinto de ejemplo",
        city: "Ciudad de ejemplo",
        country: "País de ejemplo",
        eventType: "fight_night",
        fights: [
          {
            firstFighter: "Ejemplo Uno",
            secondFighter: "Ejemplo Dos",
            boutBlock: "main",
            isMainEvent: true,
          },
          {
            firstFighter: "Ejemplo Tres",
            secondFighter: "Ejemplo Cuatro",
            boutBlock: "preliminaries",
            isMainEvent: false,
          },
        ],
      },
    ],
  };
}
