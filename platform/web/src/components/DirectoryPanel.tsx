import { Building2, ChevronDown, MapPin, Navigation, Phone, PhoneForwarded, UserRoundCheck } from 'lucide-react';
import type { AreaLookup, Hotline } from '../types';
import { UnitDirectory } from './UnitDirectory';
import { stationDirectionsUrl } from '../directions';
import { CountUp } from './CountUp';

interface DirectoryPanelProps {
  area: AreaLookup;
  isFixture: boolean;
  hotlines: Hotline[];
}

function formatNumber(value: number | null): string {
  return value === null ? 'Đang cập nhật' : value.toLocaleString('vi-VN');
}

function telHref(phone: string): string {
  return `tel:${phone.replace(/[^0-9+]/g, '')}`;
}

export function DirectoryPanel({ area, isFixture, hotlines }: DirectoryPanelProps) {
  const publicContacts = area.directory;
  const directionsUrl = stationDirectionsUrl(area);
  const hotlineGroups = Object.entries(hotlines.reduce<Record<string, Hotline[]>>((groups, hotline) => {
    (groups[hotline.categoryLabel] ??= []).push(hotline);
    return groups;
  }, {}));
  return (
    <section className="area-result" aria-labelledby="area-result-title">
      {isFixture && <p className="demo-notice" role="status">Đang hiển thị dữ liệu minh họa để kiểm thử giao diện.</p>}
      <div className="area-heading">
        <div>
          <p className="eyebrow">Mã địa bàn {area.code}</p>
          <h2 id="area-result-title">{area.name}</h2>
          <p>{[area.localityType, area.provinceName].filter(Boolean).join(' · ')}</p>
        </div>
        <MapPin size={24} aria-hidden="true" />
      </div>

      <dl className="area-metrics" aria-label="Thông tin địa bàn">
        <div><dt>Dân số</dt><dd>{area.population === null ? 'Đang cập nhật' : <CountUp key={area.code} value={area.population} suffix=" người" />}</dd></div>
        <div><dt>Diện tích</dt><dd>{area.areaKm2 === null ? 'Đang cập nhật' : <CountUp key={area.code} value={area.areaKm2} decimals={Number.isInteger(area.areaKm2) ? 0 : 2} suffix=" km²" />}</dd></div>
      </dl>

      <details className="directory-section" open>
        <summary>
          <span className="section-icon"><Building2 size={20} aria-hidden="true" /></span>
          <span className="section-copy">
            <strong>Trụ sở Công an</strong>
          </span>
          <ChevronDown className="section-chevron" size={20} aria-hidden="true" />
        </summary>
        <div className="section-content">
          {area.station ? (
            <div className="station-card">
              <strong>{area.station.name}</strong>
              <p>{area.station.address || 'Địa chỉ đang được xác minh'}</p>
              {directionsUrl && (
                <a className="directions-button" href={directionsUrl} target="_blank" rel="noreferrer">
                  <Navigation size={17} aria-hidden="true" /> Mở chỉ đường Google Maps
                </a>
              )}
            </div>
          ) : <p className="empty-copy">Chưa có thông tin trụ sở công khai.</p>}
        </div>
      </details>

      <details className="directory-section" open>
        <summary>
          <span className="section-icon"><UserRoundCheck size={20} aria-hidden="true" /></span>
          <span className="section-copy">
            <strong>Đầu mối theo địa bàn</strong>
          </span>
          <ChevronDown className="section-chevron" size={20} aria-hidden="true" />
        </summary>
        <div className="section-content contact-content">
          {publicContacts.length > 0 ? (
            <div className="directory-list">
              {publicContacts.map((entry) => (
                <article className="contact-card" key={entry.id}>
                  <div className="contact-copy">
                    <strong>{entry.displayName}</strong>
                    {(entry.rank || entry.roleTitle) && (
                      <p>{[entry.rank, entry.roleTitle].filter(Boolean).join(' · ')}</p>
                    )}
                  </div>
                  <a className="call-button" href={telHref(entry.phone)} aria-label={`Gọi ${entry.displayName}`}>
                    <Phone size={18} aria-hidden="true" />
                    <span>{entry.phone}</span>
                  </a>
                </article>
              ))}
            </div>
          ) : <p className="empty-copy">Danh bạ địa bàn đang được cập nhật.</p>}
        </div>
      </details>

      <UnitDirectory />
      <details className="directory-section hotline-section">
        <summary>
          <span className="section-icon"><PhoneForwarded size={20} aria-hidden="true" /></span>
          <span className="section-copy">
            <strong>Hotline công khai</strong>
            {!hotlines.length && <small>Đang tải dữ liệu hotline</small>}
          </span>
          <ChevronDown className="section-chevron" size={20} aria-hidden="true" />
        </summary>
        <div className="section-content hotline-groups">
          {hotlineGroups.length ? hotlineGroups.map(([category, entries]) => (
            <section key={category}>
              <h3>{category}</h3>
              <div className="hotline-list">
                {entries?.map((entry) => (
                  <article key={entry.id}>
                    <span>{entry.label}</span>
                    <a href={telHref(entry.phone)} aria-label={`Gọi ${entry.label}`}><Phone size={16} aria-hidden="true" />{entry.phone}</a>
                  </article>
                ))}
              </div>
            </section>
          )) : <p className="empty-copy">Chưa tải được dữ liệu hotline công khai.</p>}
        </div>
      </details>
    </section>
  );
}
