#!/bin/bash
echo "Security Audit"
grep -r "postgresql://" . --include="*.py" | grep -v ".env" && echo "Found URIs" || echo "Clean"
grep -r "api[_-]key" . --include="*.py" -i | grep -v ".env" && echo "Found keys" || echo "Clean"
grep "\.env" .gitignore && echo ".env ignored" || echo "ADD .env to gitignore"