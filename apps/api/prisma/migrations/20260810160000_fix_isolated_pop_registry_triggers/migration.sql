-- The telemetry isolation migration moved the global proof-of-play session
-- registry out of public. The existing trigger functions retained explicit
-- public-qualified references, so changing their search_path alone could not
-- redirect inserts and deletes to the isolated registry.

CREATE OR REPLACE FUNCTION public.wizer_claim_proof_of_play_session()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = wizer_telemetry, public
AS $$
BEGIN
  INSERT INTO wizer_telemetry."proof_of_play_session_keys"
    ("companyId", "playbackSessionId", "screenId", "proofOfPlayId", "startedAt")
  VALUES
    (NEW."companyId", NEW."playbackSessionId", NEW."screenId", NEW."id", NEW."startedAt");
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.wizer_release_proof_of_play_session()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = wizer_telemetry, public
AS $$
BEGIN
  DELETE FROM wizer_telemetry."proof_of_play_session_keys"
   WHERE "companyId" = OLD."companyId"
     AND "playbackSessionId" = OLD."playbackSessionId"
     AND "proofOfPlayId" = OLD."id";
  RETURN OLD;
END;
$$;
