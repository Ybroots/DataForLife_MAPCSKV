export interface Commune {
  id: string;
  ma_xa: string;
  ten_xa: string;
  name: string;
  loai: string;
  cap: number;
  ma_tinh: string;
  ten_tinh: string;
  /** null = API/nguồn chưa có số liệu; UI phải hiển thị "đang cập nhật", không được dùng 0. */
  dan_so: number | null;
  dtich_km2: number | null;
  matdo_km2: number | null;
  address: string;
  tru_so: string;
  sap_nhap: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CreateCommuneData extends Omit<Commune, 'id' | 'createdAt' | 'updatedAt'> {}
