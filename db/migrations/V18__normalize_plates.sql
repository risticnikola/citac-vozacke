-- db/migrations/V18__normalize_plates.sql
-- One-time backfill: reformat plates matching the standard
-- TOWN(2 letters)+NUMBER(3-4 digits)+SUFFIX(2 letters) pattern to
-- TOWNDIGITS-SUFFIX, uppercase. Non-matching plates (diplomatic,
-- foreign, custom/vanity) are left completely untouched, including
-- any existing whitespace.
UPDATE vehicles
SET plate = substring(s.stripped from 1 for 2)
         || substring(s.stripped from 3 for length(s.stripped) - 4)
         || '-'
         || substring(s.stripped from length(s.stripped) - 1 for 2)
FROM (
  SELECT id, upper(regexp_replace(plate, '[\s-]', '', 'g')) AS stripped
  FROM vehicles
  WHERE plate IS NOT NULL
) s
WHERE vehicles.id = s.id
  AND s.stripped ~ '^[A-Z]{2}[0-9]{3,4}[A-Z]{2}$';
