import { ApiError, invalid } from "@/server/errors";
import { json, readBodyLimited, route } from "@/server/http";
import { MAX_FILES_PER_REQUEST, MAX_UPLOAD_BYTES } from "@/server/env";
import { Semaphore } from "@/server/lib/semaphore";
import { listFiles, saveUploads } from "@/server/services/files";

export const dynamic = "force-dynamic";

const TOTAL_MAX = 120 * 1024 * 1024;
/** Tối đa 3 request upload xử lý cùng lúc (mỗi request giữ tới 120 MB trong RAM); chờ tối đa 8, quá thì 429. */
const uploadGate = new Semaphore(3, 8, "Đang có quá nhiều tệp được tải lên. Vui lòng thử lại sau ít giây.");

/** Danh sách tệp của mục (bổ sung ngoài API.md để UI liệt kê tệp). */
export const GET = route("required", async (c) => json({ files: await listFiles(c.params.id!) }));

export const POST = route("required", (c) => uploadGate.run(async () => {
  const ct = c.req.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data;/i.test(ct)) throw invalid("Cần gửi multipart/form-data.");
  const buf = await readBodyLimited(c.req, TOTAL_MAX); // chặn theo dung lượng khi đọc luồng
  let form: FormData;
  try {
    form = await new Response(buf as BodyInit, { headers: { "content-type": ct } }).formData();
  } catch {
    throw invalid("Không đọc được dữ liệu multipart.");
  }
  const entries = [...form.getAll("file"), ...form.getAll("files")].filter((v): v is File => typeof v !== "string");
  if (entries.length === 0) throw invalid("Thiếu trường file.", { file: "Bắt buộc" });
  if (entries.length > MAX_FILES_PER_REQUEST) throw invalid(`Tối đa ${MAX_FILES_PER_REQUEST} tệp mỗi lần.`);
  for (const e of entries) {
    if (e.size > MAX_UPLOAD_BYTES) throw new ApiError("payload_too_large", `Tệp "${e.name}" vượt quá 50 MB.`);
  }
  const files = await Promise.all(entries.map(async (e) => ({ name: e.name, data: new Uint8Array(await e.arrayBuffer()) })));
  const saved = await saveUploads(c.params.id!, files, c.user.id, c.ip);
  return json({ files: saved }, { status: 201 });
}));
