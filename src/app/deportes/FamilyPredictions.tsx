import styles from "./family-predictions.module.css";

type FamilyChoice = {
  memberId: string;
  name: string;
  choice: string;
  correct: boolean | null;
};

export default function FamilyPredictions({
  context,
  closed,
  choices,
  points,
  voided = false,
}: {
  context: string;
  closed: boolean;
  choices: FamilyChoice[];
  points: number;
  voided?: boolean;
}) {
  return (
    <section className={styles.family} aria-label={`Pronósticos de la familia · ${context}`}>
      <div className={styles.heading}>
        <strong>Pronósticos de la familia</strong>
        {closed && <span>{choices.length} {choices.length === 1 ? "pronóstico" : "pronósticos"}</span>}
      </div>
      {!closed ? (
        <p>Las elecciones de la familia se revelan al cierre de los pronósticos.</p>
      ) : choices.length === 0 ? (
        <p>Nadie hizo un pronóstico.</p>
      ) : (
        <ul className={styles.list}>
          {choices.toSorted((a, b) => a.name.localeCompare(b.name, "es") || a.memberId.localeCompare(b.memberId)).map((choice) => (
            <li className={styles.row} key={choice.memberId}>
              <div className={styles.pick}>
                <strong>{choice.name}</strong>
                <span>{choice.choice}</span>
              </div>
              <span className={`${styles.result} ${!voided && choice.correct === true ? styles.correct : ""}`}>
                {voided ? "No puntúa" : choice.correct === null ? "Pendiente" : choice.correct ? `Acertó · +${points} ${points === 1 ? "punto" : "puntos"}` : "No acertó · 0 puntos"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
