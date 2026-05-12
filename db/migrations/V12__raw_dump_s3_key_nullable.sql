-- The C++ binary does not produce a raw binary dump, so raw_dump_s3_key is optional.
ALTER TABLE card_reads ALTER COLUMN raw_dump_s3_key DROP NOT NULL;
