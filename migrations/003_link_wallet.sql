-- Owner-only Link Wallet. No existing share or file data changed.
CREATE TABLE IF NOT EXISTS public.fileport_link_wallets (
 owner_sub uuid PRIMARY KEY,
 revision integer NOT NULL CHECK (revision >= 1),
 links jsonb NOT NULL CHECK (jsonb_typeof(links) = 'array' AND jsonb_array_length(links) <= 200),
 updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.fileport_link_wallets FROM PUBLIC;
