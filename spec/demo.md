# Demo frame verification

The record-demo skill's frame extractor accepts a local WebM, a scratch output
directory, and timestamps in seconds. It creates missing output directories,
including parent directories, and also accepts an existing directory. It prints
the video's duration and saves a viewer HTML file and a PNG for each timestamp.

Integration coverage in `tests/demo-frames.test.ts` runs the extractor against a
committed demo video without network requests.
