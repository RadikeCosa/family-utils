CREATE TABLE "recipe_shopping_operations" (
	"family_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"list_id" uuid NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"result" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recipe_shopping_operations" ADD CONSTRAINT "recipe_shopping_operations_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_shopping_operations" ADD CONSTRAINT "recipe_shopping_operations_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recipe_shopping_operations_unique" ON "recipe_shopping_operations" USING btree ("family_id","operation_id");--> statement-breakpoint
CREATE INDEX "recipe_shopping_operations_expiry_idx" ON "recipe_shopping_operations" USING btree ("expires_at");