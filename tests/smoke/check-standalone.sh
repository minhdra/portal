#!/usr/bin/env bash
# Kiểm bản `node .next/standalone/server.js` THẬT (F7 + F8, docs/adr/0003). Cách dùng:
#   BASE=http://127.0.0.1:3199 COOKIE='__Host-portal_session=...' PDF=<id> TXT=<id> DOCX=<id> XLSX=<id> tests/smoke/check-standalone.sh
# Chạy server từ một cwd KHÁC repo (server.js tự chdir vào .next/standalone). Thoát khác 0 nếu có kiểm tra hỏng.
set -u
fail=0
ok() { echo "OK   $*"; }
bad() { echo "FAIL $*"; fail=1; }
for q in "" "?download=1"; do
  for pair in "PDF:default-src 'none'" "TXT:sandbox" "DOCX:sandbox"; do
    name=${pair%%:*}; want=${pair#*:}; id=${!name}
    hdr=$(curl -sI -H "Cookie: $COOKIE" "$BASE/api/files/$id$q")
    n=$(printf '%s\n' "$hdr" | grep -ic '^content-security-policy:')
    csp=$(printf '%s\n' "$hdr" | grep -i '^content-security-policy:' | head -1)
    [ "$n" = 1 ] && ok "$name$q đúng 1 CSP" || bad "$name$q có $n CSP"
    case "$csp" in *"$want"*"frame-ancestors 'self'"*) ok "$name$q CSP chứa '$want' + frame-ancestors 'self'";; *) bad "$name$q CSP sai: $csp";; esac
    printf '%s\n' "$hdr" | grep -qi '^x-frame-options: SAMEORIGIN' && ok "$name$q X-Frame-Options SAMEORIGIN" || bad "$name$q thiếu X-Frame-Options SAMEORIGIN"
  done
done
for pair in "DOCX:html" "XLSX:sheets"; do
  name=${pair%%:*}; kind=${pair#*:}
  out=$(curl -s -w ' HTTP%{http_code}' -H "Cookie: $COOKIE" "$BASE/api/files/${!name}/view")
  case "$out" in *'"kind":"'$kind'"'*' HTTP200') ok "view $name chạy trên standalone";; *) bad "view $name: $out";; esac
done
exit $fail
