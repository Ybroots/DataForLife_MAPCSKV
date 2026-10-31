import { Commune } from './Commune';

/**
 * Model hiển thị danh bạ: một đầu mối kèm thông tin đơn vị/địa bàn.
 */
export interface ContactWithCommune {
  id: string;
  ma_xa: string;
  ten_xa?: string;
  fullName: string;
  mobile?: string | null;
  communeInfo?: Commune | null;
  /** Mục giữ chỗ cho địa bàn chưa tải đầu mối; ContactsScreen tải khi mở rộng. Không hiển thị như một liên hệ. */
  placeholder?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}
