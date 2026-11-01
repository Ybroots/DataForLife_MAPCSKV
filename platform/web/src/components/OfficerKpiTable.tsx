import type { OfficerKpis } from '../types';

function percent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 1000) / 10}%`;
}

function minutes(value: number | null): string {
  if (value === null) return '—';
  if (value < 60) return `${value} phút`;
  return `${Math.floor(value / 60)} giờ ${Math.round(value % 60)} phút`;
}

function score(value: number | null, count: number): string {
  return value === null ? 'Chưa có' : `${value}/5 (${count})`;
}

/** Bộ chỉ số đo lường thành công theo mục 9.2 bản mô tả giải pháp, tính trực tiếp từ dữ liệu vận hành. */
export function OfficerKpiTable({ kpis }: { kpis: OfficerKpis }) {
  const rows: Array<{ group: string; items: Array<{ label: string; value: string; note?: string }> }> = [
    {
      group: 'Mức độ tiếp cận',
      items: [
        { label: 'Tài khoản người dân (toàn hệ thống)', value: String(kpis.reach.citizenAccounts), note: `${kpis.reach.newCitizenAccounts} tài khoản mới trong kỳ` },
        { label: 'Thiết bị nhận thông báo của địa bàn', value: String(kpis.reach.pushDevices) },
        { label: 'Tỷ lệ du khách / dân cư', value: 'Chưa thu thập', note: 'Cần thêm câu hỏi khi đăng ký' },
      ],
    },
    {
      group: 'Hiệu quả phản ánh',
      items: [
        { label: 'Thời gian đến phản hồi đầu tiên (phản ánh)', value: minutes(kpis.response.incidentFirstResponseMinutes) },
        { label: 'Thời gian xác nhận SOS', value: minutes(kpis.response.sosAcknowledgeMinutes) },
        { label: 'Tỷ lệ vụ việc được phản hồi', value: percent(kpis.response.respondedRate) },
      ],
    },
    {
      group: 'Chất lượng dữ liệu',
      items: [
        { label: 'Phản ánh đã gộp trùng', value: `${kpis.dataQuality.duplicateLinked} (${percent(kpis.dataQuality.duplicateRate)})` },
        { label: 'Phản ánh có xác thực VNeID', value: 'Chưa kết nối VNeID' },
      ],
    },
    {
      group: 'Độ chính xác của AI',
      items: [
        { label: 'Gợi ý lĩnh vực được cán bộ giữ nguyên', value: `${kpis.ai.accepted}/${kpis.ai.decided} (${percent(kpis.ai.accuracy)})`, note: `${kpis.ai.reviews} lượt nhờ AI trong kỳ` },
      ],
    },
    {
      group: 'Mức độ hài lòng',
      items: [
        { label: 'Sau xử lý phản ánh', value: score(kpis.satisfaction.incidentAverage, kpis.satisfaction.incidentCount) },
        { label: 'Sau hỗ trợ SOS', value: score(kpis.satisfaction.sosAverage, kpis.satisfaction.sosCount) },
        { label: 'Đánh giá ứng dụng (toàn hệ thống)', value: score(kpis.satisfaction.appAverage, kpis.satisfaction.appCount) },
      ],
    },
  ];
  return (
    <section className="kpi-table" aria-labelledby="kpi-table-title">
      <h4 id="kpi-table-title">Bộ chỉ số đo lường</h4>
      <p>Tính tự động từ dữ liệu vận hành trong kỳ đã chọn. “—” là chưa có dữ liệu.</p>
      {rows.map((row) => (
        <div className="kpi-group" key={row.group}>
          <h5>{row.group}</h5>
          <dl>
            {row.items.map((item) => (
              <div key={item.label}>
                <dt>{item.label}{item.note && <small>{item.note}</small>}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </section>
  );
}
