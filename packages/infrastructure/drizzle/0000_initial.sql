CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "citations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notebook_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"passage_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"source_title" text NOT NULL,
	"label" text NOT NULL,
	"locator" jsonb NOT NULL,
	"excerpt" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "citations_message_label_unique" UNIQUE("message_id","label")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notebook_id" uuid NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_id_notebook_unique" UNIQUE("id","notebook_id")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notebook_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"status" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_id_notebook_unique" UNIQUE("id","notebook_id"),
	CONSTRAINT "messages_role_check" CHECK ("messages"."role" in ('researcher', 'assistant')),
	CONSTRAINT "messages_status_check" CHECK ("messages"."status" in ('pending', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "notebooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notebook_id" uuid NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"source_message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notebook_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"content" text NOT NULL,
	"locator" jsonb NOT NULL,
	"token_estimate" integer NOT NULL,
	"embedding" vector NOT NULL,
	"embedding_model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "passages_id_notebook_source_unique" UNIQUE("id","notebook_id","source_id"),
	CONSTRAINT "passages_source_ordinal_unique" UNIQUE("source_id","ordinal")
);
--> statement-breakpoint
CREATE TABLE "provider_configurations" (
	"kind" text NOT NULL,
	"base_url" text NOT NULL,
	"model" text NOT NULL,
	"encrypted_api_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_configurations_kind_pk" PRIMARY KEY("kind"),
	CONSTRAINT "provider_kind_check" CHECK ("provider_configurations"."kind" in ('chat', 'embedding'))
);
--> statement-breakpoint
CREATE TABLE "source_processing_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notebook_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"failure" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "source_attempts_status_check" CHECK ("source_processing_attempts"."status" in ('running', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notebook_id" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"mime_type" text NOT NULL,
	"original_url" text,
	"storage_key" text,
	"content_hash" text,
	"size_bytes" bigint,
	"passage_count" integer DEFAULT 0 NOT NULL,
	"failure" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sources_id_notebook_unique" UNIQUE("id","notebook_id"),
	CONSTRAINT "sources_kind_check" CHECK ("sources"."kind" in ('pdf', 'web', 'text', 'markdown')),
	CONSTRAINT "sources_status_check" CHECK ("sources"."status" in ('queued', 'extracting', 'indexing', 'ready', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_message_notebook_fk" FOREIGN KEY ("message_id","notebook_id") REFERENCES "public"."messages"("id","notebook_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_passage_notebook_source_fk" FOREIGN KEY ("passage_id","notebook_id","source_id") REFERENCES "public"."passages"("id","notebook_id","source_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_notebook_id_notebooks_id_fk" FOREIGN KEY ("notebook_id") REFERENCES "public"."notebooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_notebook_fk" FOREIGN KEY ("conversation_id","notebook_id") REFERENCES "public"."conversations"("id","notebook_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_notebook_id_notebooks_id_fk" FOREIGN KEY ("notebook_id") REFERENCES "public"."notebooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_source_message_notebook_fk" FOREIGN KEY ("source_message_id","notebook_id") REFERENCES "public"."messages"("id","notebook_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passages" ADD CONSTRAINT "passages_source_notebook_fk" FOREIGN KEY ("source_id","notebook_id") REFERENCES "public"."sources"("id","notebook_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_processing_attempts" ADD CONSTRAINT "source_attempts_source_notebook_fk" FOREIGN KEY ("source_id","notebook_id") REFERENCES "public"."sources"("id","notebook_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_notebook_id_notebooks_id_fk" FOREIGN KEY ("notebook_id") REFERENCES "public"."notebooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_notebook_updated_idx" ON "conversations" USING btree ("notebook_id","updated_at");--> statement-breakpoint
CREATE INDEX "messages_conversation_created_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "notes_notebook_updated_idx" ON "notes" USING btree ("notebook_id","updated_at");--> statement-breakpoint
CREATE INDEX "passages_notebook_model_idx" ON "passages" USING btree ("notebook_id","embedding_model");--> statement-breakpoint
CREATE INDEX "source_attempts_source_started_idx" ON "source_processing_attempts" USING btree ("source_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sources_notebook_hash_unique" ON "sources" USING btree ("notebook_id","content_hash") WHERE "sources"."content_hash" is not null;--> statement-breakpoint
CREATE INDEX "sources_notebook_created_idx" ON "sources" USING btree ("notebook_id","created_at");
