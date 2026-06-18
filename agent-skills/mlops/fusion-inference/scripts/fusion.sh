#!/bin/sh
# Quick fusion CLI wrapper
# Usage: fusion "your prompt here"
#        fusion "prompt" --panel "model1:name1,model2:name2"
#        fusion "prompt" --local

exec python3 /path/to/fusion.py "$@"
