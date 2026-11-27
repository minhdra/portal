-- Chạy TRƯỚC khi deploy migration 20261128000000_security_hardening (unique (item_id, sha256)) trên DB có dữ liệu thật:
--   psql "$DATABASE_URL" -f scripts/db/check-dup-files.sql
-- Migration xoá hàng trùng (giữ hàng cũ nhất); blob của hàng bị xoá thành mồ côi trên đĩa. Script này CHỈ ĐỌC.
-- Chạy trước migration thì thấy các nhóm trùng; chạy sau migration thì phải trả 0 hàng (kiểm tra unique đã có hiệu lực).

-- 1) Số nhóm trùng và số hàng sẽ bị xoá.
SELECT count(*) AS nhom_trung, coalesce(sum(n - 1), 0) AS hang_se_bi_xoa
FROM (SELECT count(*) AS n FROM file GROUP BY item_id, sha256 HAVING count(*) > 1) t;

-- 2) Chi tiết: hàng nào được giữ (cũ nhất), hàng nào bị xoá, storage_key của blob sẽ mồ côi.
SELECT item_id, sha256, id, storage_key, original_name, created_at,
       CASE WHEN rn = 1 THEN 'GIU' ELSE 'XOA (blob mo coi)' END AS hanh_dong
FROM (
  SELECT f.*, row_number() OVER (PARTITION BY f.item_id, f.sha256 ORDER BY f.created_at, f.id) AS rn,
         count(*) OVER (PARTITION BY f.item_id, f.sha256) AS n
  FROM file f
) t
WHERE n > 1
ORDER BY item_id, sha256, rn;
