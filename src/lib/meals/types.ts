import type { MealType, ParticipationStatus } from "./rules";

export type Role = "administrator" | "member";
export type Profile = { id: string; name: string; role: Role };
export type Attendance = {
  memberId: string;
  status: ParticipationStatus;
  groupId: string | null;
  updatedByMemberId: string | null;
  updatedByName: string | null;
  updatedAt: string | null;
};
export type Suggestion = { id: string; authorMemberId: string; authorName: string; title: string; note: string | null; version: number; createdAt: string; updatedAt: string };
export type Selection = { suggestionId: string; title: string | null; proposedById: string | null; proposedByName: string | null; confirmedByMemberId: string; confirmedByName: string; confirmedAt: string; version: number };
export type Group = { id: string | null; kind: "home" | "packed" | "shared"; name: string; isDefault: boolean; followsHome: boolean; selection: Selection | null; selectionVersion: number };
export type Meal = {
  groups: Group[];
  distributionOrigin: string;
  distributionSaved: boolean;
  noRoutineMemberIds: string[];
  date: string;
  mealType: MealType;
  slotId: string | null;
  attendance: Attendance[];
  suggestions: Suggestion[];
  selection: Selection | null;
  selectionVersion: number;
};
export type WeekData = { weekStart: string; weekEnd: string; today: string; timeZone: string; revision: number; currentMemberId: string; currentRole: Role; members: Profile[]; meals: Meal[] };

export type MealIdea = {id:string;authorMemberId:string;authorName:string;title:string;note:string|null;mealTypes:MealType[];packedSuitable:boolean;version:number;archivedAt:string|null;createdAt:string;updatedAt:string};
