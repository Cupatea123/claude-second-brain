# Drop folder for sources

Drop articles (.md, .html, .txt), PDFs and transcripts (.vtt, .srt, .txt) here, then run `/brain ingest`.

Each source becomes one summary note in `3-Resources/` (type `resource`, tag `source`) with provenance in its
frontmatter (`source`, `source_file`, `source_hash`, `ingested`) and links to the projects and areas it bears on.
The raw file moves to `processed/` here.

Everything in this folder except this README is gitignored and skipped by `lint`: sources can be large or
copyrighted, and the summary is what the vault keeps. Never drop anything with secrets in it.
