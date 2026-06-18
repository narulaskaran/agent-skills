#!/bin/sh
# Quick fusion: run panel (deepseek-r1 + coder:14b), DeepSeek judges
# Usage: fusion "your prompt here"
#        fusion "prompt" --panel coder,14b,gemma4
#        fusion "prompt" --local
# Installed at /opt/data/bin/fusion — copy to any PATH directory

exec /opt/data/veval/bin/python3 /opt/data/eval-harness/fusion.py "$@"
