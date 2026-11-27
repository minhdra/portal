/** Sinh một PDF 1 trang rất nhỏ (chữ Helvetica) để dùng làm dữ liệu mẫu. */
export function makePdf(title: string, lines: string[]): Blob {
  const esc = (s: string) =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").replace(/[\\()]/g, "\\$&");
  let content = `BT /F1 20 Tf 56 760 Td (${esc(title)}) Tj ET\n`;
  lines.forEach((l, i) => {
    content += `BT /F1 12 Tf 56 ${720 - i * 20} Td (${esc(l)}) Tj ET\n`;
  });
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offs: number[] = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offs) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([out], { type: "application/pdf" });
}

export function makePng(): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = 480;
  c.height = 300;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 480, 300);
  grad.addColorStop(0, "#99f6e4");
  grad.addColorStop(1, "#0f766e");
  g.fillStyle = grad;
  g.fillRect(0, 0, 480, 300);
  g.fillStyle = "rgba(255,255,255,.85)";
  g.beginPath();
  g.arc(120, 100, 36, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(0, 300);
  g.lineTo(150, 170);
  g.lineTo(260, 250);
  g.lineTo(360, 140);
  g.lineTo(480, 260);
  g.lineTo(480, 300);
  g.closePath();
  g.fillStyle = "rgba(6,48,43,.6)";
  g.fill();
  return new Promise((res) => c.toBlob((b) => res(b ?? new Blob([], { type: "image/png" })), "image/png"));
}
