export type TrainingExercise = { name: string } & (
  | { mode: "repetitions"; repetitions: number; seconds?: never }
  | { mode: "time"; seconds: number; repetitions?: never }
);
export interface TrainingBlock { name: string; rounds: number; exercises: TrainingExercise[] }
export interface RoutineInput { name: string; blocks: TrainingBlock[] }
export interface SessionInput extends RoutineInput { sourceRoutineId: string; performedOn: string; durationSeconds: number; effort: number; note: string }
export interface TrainingRoutine extends RoutineInput { id: string; version: number; archivedAt: string | null; createdAt: string; updatedAt: string }
export interface TrainingSession extends SessionInput { id: string; version: number; createdAt: string; updatedAt: string }
export interface TrainingPage<T> { items: T[]; nextCursor: string | null; today: string }
