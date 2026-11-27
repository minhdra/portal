// Sinh từ assets/icons và assets/illustrations (tự vẽ, nội dung tĩnh tin cậy).
export const ICON_PATHS: Record<string, string> = {
 "cloud": "<path d=\"M7 18a4.500 4.500 0 0 1-.5-9A6 6 0 0 1 18 9.500 4.300 4.300 0 0 1 17.500 18z\"/>",
 "database": "<ellipse cx=\"12\" cy=\"6\" rx=\"7.500\" ry=\"3\"/><path d=\"M4.500 6v12c0 1.700 3.400 3 7.500 3s7.500-1.300 7.500-3V6\"/><path d=\"M4.500 12c0 1.700 3.400 3 7.500 3s7.500-1.300 7.500-3\"/>",
 "doc": "<path d=\"M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z\"/><path d=\"M14 3v5h5\"/><path d=\"M9 13h6M9 17h6\"/>",
 "drag": "<circle cx=\"9\" cy=\"6\" r=\"1.200\"/><circle cx=\"15\" cy=\"6\" r=\"1.200\"/><circle cx=\"9\" cy=\"12\" r=\"1.200\"/><circle cx=\"15\" cy=\"12\" r=\"1.200\"/><circle cx=\"9\" cy=\"18\" r=\"1.200\"/><circle cx=\"15\" cy=\"18\" r=\"1.200\"/>",
 "edit": "<path d=\"M4 20h4L19.500 8.500a2.100 2.100 0 0 0-3-3L5 17z\"/><path d=\"M14.500 7.500l3 3\"/>",
 "folder": "<path d=\"M3 7a2 2 0 0 1 2-2h4l2 2.500h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z\"/>",
 "home": "<path d=\"M3 11.500L12 4l9 7.500\"/><path d=\"M5.500 10v10h13V10\"/><path d=\"M10 20v-6h4v6\"/>",
 "image": "<rect x=\"3.500\" y=\"4.500\" width=\"17\" height=\"15\" rx=\"2\"/><circle cx=\"9\" cy=\"10\" r=\"1.800\"/><path d=\"M4 18l5-4.500 3.500 3 3-2.500 4.500 4\"/>",
 "link": "<path d=\"M10 14a4 4 0 0 0 5.700 0l3.500-3.500a4 4 0 0 0-5.700-5.700L12.500 5.800\"/><path d=\"M14 10a4 4 0 0 0-5.700 0L4.800 13.500a4 4 0 0 0 5.700 5.700l1-1\"/>",
 "logout": "<path d=\"M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4\"/><path d=\"M15 8l4 4-4 4\"/><path d=\"M9 12h10\"/>",
 "map": "<path d=\"M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z\"/><path d=\"M9 4v14M15 6v14\"/>",
 "note": "<path d=\"M5 4h14v12l-4 4H5z\"/><path d=\"M15 20v-4h4\"/><path d=\"M9 9h6M9 13h3\"/>",
 "pdf": "<path d=\"M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z\"/><path d=\"M14 3v5h5\"/><path d=\"M8 17v-4h1.500a1.200 1.200 0 0 1 0 2.400H8M12.500 13v4M12.500 13h1a2 2 0 0 1 0 4h-1\"/>",
 "search": "<circle cx=\"10.500\" cy=\"10.500\" r=\"6.500\"/><path d=\"M15.500 15.500L21 21\"/>",
 "server": "<rect x=\"3.500\" y=\"4\" width=\"17\" height=\"6.500\" rx=\"1.500\"/><rect x=\"3.500\" y=\"13.500\" width=\"17\" height=\"6.500\" rx=\"1.500\"/><path d=\"M7.500 7.200h.01M7.500 16.700h.01M12 7.200h5M12 16.700h5\"/>",
 "settings": "<circle cx=\"12\" cy=\"12\" r=\"3\"/><path d=\"M12 2.500v3M12 18.500v3M2.500 12h3M18.500 12h3M5.300 5.300l2.100 2.100M16.600 16.600l2.100 2.100M5.300 18.700l2.100-2.100M16.600 7.400l2.100-2.100\"/>",
 "sheet": "<rect x=\"4\" y=\"4\" width=\"16\" height=\"16\" rx=\"2\"/><path d=\"M4 10h16M4 15h16M10 4v16\"/>",
 "star": "<path d=\"M12 3.500l2.700 5.500 6 .9-4.400 4.200 1 6-5.300-2.800-5.300 2.800 1-6L3.300 9.900l6-.9z\"/>",
 "theme": "<circle cx=\"12\" cy=\"12\" r=\"8.500\"/><path d=\"M12 3.500v17\"/><path d=\"M12 3.500a8.500 8.500 0 0 1 0 17z\" fill=\"currentColor\"/>",
 "tool": "<path d=\"M16.500 3.500a4.500 4.500 0 0 0-4.300 6L4.800 17a2 2 0 0 0 2.800 2.800l7.400-7.400a4.500 4.500 0 0 0 6-4.300 4 4 0 0 0-.2-1.200L17.500 9.500 14.500 6.500l2.900-2.900a4 4 0 0 0-.9-.1z\"/>",
 "trash": "<path d=\"M4 7h16\"/><path d=\"M9 7V4h6v3\"/><path d=\"M6 7l1 13h10l1-13\"/><path d=\"M10 11v5M14 11v5\"/>",
 "upload": "<path d=\"M12 16V4\"/><path d=\"M7 9l5-5 5 5\"/><path d=\"M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3\"/>",
 "user": "<circle cx=\"12\" cy=\"8\" r=\"4\"/><path d=\"M4 20c0-4 3.500-6 8-6s8 2 8 6\"/>",
 "web": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M3 12h18\"/><path d=\"M12 3c2.500 2.500 3.500 5.500 3.500 9S14.500 18.500 12 21c-2.500-2.500-3.500-5.500-3.500-9S9.500 5.500 12 3z\"/>",
 "plus": "<path d=\"M12 5v14M5 12h14\"/>",
 "menu": "<path d=\"M4 7h16M4 12h16M4 17h16\"/>",
 "close": "<path d=\"M6 6l12 12M18 6L6 18\"/>",
 "download": "<path d=\"M12 4v11M7.500 10.500L12 15l4.500-4.500M5 20h14\"/>",
 "external": "<path d=\"M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4\"/>",
 "alert": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 7.500v5.500M12 16.500v.01\"/>",
 "check": "<path d=\"M5 12.500l4.500 4.500L19 7.500\"/>",
 "bold": "<path d=\"M7 5h6a3.500 3.500 0 0 1 0 7H7zM7 12h7a3.500 3.500 0 0 1 0 7H7z\"/>",
 "list": "<path d=\"M9 6h11M9 12h11M9 18h11M4.500 6h.01M4.500 12h.01M4.500 18h.01\"/>",
 "table": "<rect x=\"4\" y=\"5\" width=\"16\" height=\"14\" rx=\"2\"/><path d=\"M4 10h16M4 14.500h16M10 5v14\"/>",
 "code": "<path d=\"M9 7l-5 5 5 5M15 7l5 5-5 5\"/>",
 "heading": "<path d=\"M6 5v14M18 5v14M6 12h12\"/>",
 "history": "<path d=\"M4 12a8 8 0 1 0 2.500-5.800M4 4v4h4M12 8v4.500l3 2\"/>",
 "chevron": "<path d=\"M9 6l6 6-6 6\"/>",
 "up": "<path d=\"M12 19V6M6.500 11.500L12 6l5.500 5.500\"/>",
 "down": "<path d=\"M12 5v13M6.500 12.500L12 18l5.500-5.500\"/>",
 "pin": "<path d=\"M9 4h6l-1 5 3 3v2H7v-2l3-3zM12 14v6\"/>",
 "clock": "<circle cx=\"12\" cy=\"12\" r=\"8.500\"/><path d=\"M12 7.500V12l3 2\"/>",
 "all": "<rect x=\"4\" y=\"4\" width=\"7\" height=\"7\" rx=\"1.500\"/><rect x=\"13\" y=\"4\" width=\"7\" height=\"7\" rx=\"1.500\"/><rect x=\"4\" y=\"13\" width=\"7\" height=\"7\" rx=\"1.500\"/><rect x=\"13\" y=\"13\" width=\"7\" height=\"7\" rx=\"1.500\"/>",
 "archive": "<rect x=\"4\" y=\"4\" width=\"16\" height=\"4\" rx=\"1\"/><path d=\"M5.500 8v10a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8M10 12.500h4\"/>",
 "quote": "<path d=\"M6 17v-4a4 4 0 0 1 4-4M14 17v-4a4 4 0 0 1 4-4\"/>"
};
export const ILLUSTRATIONS: Record<string, { vb: string; body: string }> = {
 "empty-no-item": {
  "vb": "0 0 240 180",
  "body": "<ellipse cx=\"120\" cy=\"156\" rx=\"78\" ry=\"9\" fill=\"currentColor\" opacity=\".08\"/><rect x=\"62\" y=\"46\" width=\"116\" height=\"100\" rx=\"10\" fill=\"currentColor\" opacity=\".07\"/><rect x=\"62\" y=\"46\" width=\"116\" height=\"100\" rx=\"10\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"3\" opacity=\".55\"/><path d=\"M62 104h34l6 10h36l6-10h34\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"3\" stroke-linejoin=\"round\" opacity=\".55\"/><g fill=\"currentColor\" opacity=\".18\"><rect x=\"82\" y=\"62\" width=\"50\" height=\"8\" rx=\"4\"/><rect x=\"82\" y=\"78\" width=\"76\" height=\"8\" rx=\"4\"/></g><circle cx=\"176\" cy=\"46\" r=\"16\" fill=\"var(--accent,#0d9488)\"/><path d=\"M176 38v16M168 46h16\" stroke=\"#fff\" stroke-width=\"4\" stroke-linecap=\"round\"/>"
 },
 "empty-no-topic": {
  "vb": "0 0 240 180",
  "body": "<ellipse cx=\"120\" cy=\"156\" rx=\"78\" ry=\"9\" fill=\"currentColor\" opacity=\".08\"/><g fill=\"none\" stroke=\"currentColor\" stroke-width=\"3\" stroke-linecap=\"round\" stroke-linejoin=\"round\" opacity=\".55\"><path d=\"M60 62a8 8 0 0 1 8-8h30l10 12h64a8 8 0 0 1 8 8v66a8 8 0 0 1-8 8H68a8 8 0 0 1-8-8z\" stroke-dasharray=\"7 7\"/></g><circle cx=\"168\" cy=\"48\" r=\"20\" fill=\"var(--accent,#0d9488)\"/><path d=\"M168 38v20M158 48h20\" stroke=\"#fff\" stroke-width=\"4\" stroke-linecap=\"round\"/><g fill=\"currentColor\" opacity=\".18\"><rect x=\"82\" y=\"92\" width=\"76\" height=\"8\" rx=\"4\"/><rect x=\"82\" y=\"110\" width=\"52\" height=\"8\" rx=\"4\"/></g>"
 },
 "empty-not-found": {
  "vb": "0 0 240 180",
  "body": "<ellipse cx=\"120\" cy=\"156\" rx=\"78\" ry=\"9\" fill=\"currentColor\" opacity=\".08\"/><rect x=\"52\" y=\"34\" width=\"110\" height=\"112\" rx=\"10\" fill=\"currentColor\" opacity=\".07\"/><rect x=\"52\" y=\"34\" width=\"110\" height=\"112\" rx=\"10\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"3\" opacity=\".55\"/><g fill=\"currentColor\" opacity=\".18\"><rect x=\"70\" y=\"52\" width=\"50\" height=\"8\" rx=\"4\"/><rect x=\"70\" y=\"70\" width=\"74\" height=\"8\" rx=\"4\"/><rect x=\"70\" y=\"88\" width=\"40\" height=\"8\" rx=\"4\"/></g><circle cx=\"150\" cy=\"104\" r=\"26\" fill=\"var(--bg,transparent)\" stroke=\"var(--accent,#0d9488)\" stroke-width=\"6\"/><path d=\"M169 123l24 24\" stroke=\"var(--accent,#0d9488)\" stroke-width=\"8\" stroke-linecap=\"round\"/><path d=\"M141 95l18 18M159 95l-18 18\" stroke=\"var(--accent,#0d9488)\" stroke-width=\"4\" stroke-linecap=\"round\"/>"
 }
};
