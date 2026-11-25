-- STATIC FILEPORT · dedicated Neon metadata and primary Neon Object Storage; optional R2 backend.
-- Applied 2026-11-23 to Neon project delicate-darkness-21715937 / main.
CREATE TABLE IF NOT EXISTS public.fileport_workspaces (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z][a-z0-9-]{1,46}[a-z0-9]$'),
 name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
 description text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.fileport_files (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES public.fileport_workspaces(id),
 storage_provider text NOT NULL DEFAULT 'neon' CHECK (storage_provider IN ('neon','r2')),
 storage_key text NOT NULL UNIQUE,
 display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 255),
 mime_type text NOT NULL DEFAULT 'application/octet-stream',
 bytes bigint NOT NULL CHECK (bytes BETWEEN 0 AND 26214400),
 state text NOT NULL DEFAULT 'staged' CHECK (state IN ('staged','approved','disabled')),
 created_at timestamptz NOT NULL DEFAULT now(),
 approved_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.fileport_shares (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES public.fileport_workspaces(id),
 token_hash text NOT NULL UNIQUE CHECK (char_length(token_hash)=64),
 title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 150),
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.fileport_share_files (
 share_id uuid NOT NULL REFERENCES public.fileport_shares(id) ON DELETE CASCADE,
 file_id uuid NOT NULL REFERENCES public.fileport_files(id),
 PRIMARY KEY(share_id,file_id)
);
CREATE TABLE IF NOT EXISTS public.fileport_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 action text NOT NULL CHECK (action IN ('upload','approve','disable','share_created','share_viewed','file_opened','share_revoked')),
 workspace_id uuid REFERENCES public.fileport_workspaces(id) ON DELETE SET NULL,
 share_id uuid REFERENCES public.fileport_shares(id) ON DELETE SET NULL,
 file_id uuid REFERENCES public.fileport_files(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fileport_files_workspace ON public.fileport_files(workspace_id,created_at DESC);
CREATE INDEX IF NOT EXISTS fileport_shares_workspace ON public.fileport_shares(workspace_id,created_at DESC);
CREATE INDEX IF NOT EXISTS fileport_events_created ON public.fileport_events(created_at DESC);
INSERT INTO public.fileport_workspaces(slug,name,description) VALUES
 ('static-collective','Static Collective','Shared intranet files and project workbenches'),
 ('willowlab','WillowLab','Independent WillowLab collaboration materials')
 ON CONFLICT(slug) DO NOTHING;

-- Owner-only Link Wallet. No existing share or file data changed.
CREATE TABLE IF NOT EXISTS public.fileport_link_wallets (
 owner_sub uuid PRIMARY KEY,
 revision integer NOT NULL CHECK (revision >= 1),
 links jsonb NOT NULL CHECK (jsonb_typeof(links) = 'array' AND jsonb_array_length(links) <= 200),
 updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.fileport_link_wallets FROM PUBLIC;
