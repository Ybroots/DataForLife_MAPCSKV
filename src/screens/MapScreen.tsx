// @ts-nocheck
import React, { useRef, useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  Modal,
  ScrollView,
  Image,
  Linking,
  Alert,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useRoute } from "@react-navigation/native";
import MapView, {
  Polygon,
  PROVIDER_GOOGLE,
  Region,
} from "react-native-maps";
import AntDesign from "@expo/vector-icons/AntDesign";
import Ionicons from "@expo/vector-icons/Ionicons";
import Entypo from "@expo/vector-icons/Entypo";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import FontAwesome5 from "@expo/vector-icons/FontAwesome5";
import * as Clipboard from "expo-clipboard";
import { lookupByCode } from "../services/DirectoryService";
import { Commune } from "../models/Commune";
// @ts-ignore – cho phép import file GeoJSON lớn (dùng cho polygon offline, sẽ thay bằng API trong bước sau)
import mapData from "../../map34.json";

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },

  bottomSheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 16,
    paddingBottom: 24,
    paddingHorizontal: 16,
    maxHeight: "80%",
  },

  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },

  sheetHeaderSide: {
    width: 32,
    alignItems: "center",
    justifyContent: "center",
  },

  sheetTitleWrapper: {
    flex: 1,
    alignItems: "center",
  },

  sheetCloseButton: {
    padding: 4,
  },

  sheetLogo: {
    width: 56,
    height: 56,
    marginBottom: 8,
    resizeMode: "contain",
  },

  sheetTitle: {
    fontSize: 20,
    fontWeight: "600",
    textAlign: "center",
  },

  sheetSubtitle: {
    fontSize: 14,
    color: "#777",
    marginTop: 4,
    textAlign: "center",
  },

  pillRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12,
  },

  pill: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginRight: 8,
  },

  pillLabel: {
    fontSize: 13,
    color: "#555",
    marginBottom: 4,
  },

  pillValue: {
    fontSize: 15,
    fontWeight: "600",
  },

  card: {
    marginTop: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: "#eee",
  },

  cardLabel: {
    fontSize: 13,
    color: "#777",
    marginBottom: 4,
  },

  cardValue: {
    fontSize: 15,
  },

  rowWithIcon: {
    flexDirection: "row",
    alignItems: "flex-start",
  },

  rowIconWrapper: {
    width: 24,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },

  rowTextWrapper: {
    flex: 1,
  },

  copyIconButton: {
    paddingHorizontal: 4,
    paddingVertical: 2,
  },

  actionButton: {
    marginTop: 12,
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    backgroundColor: '#dc3545',
  },

  actionButtonText: {
    fontSize: 15,
    fontWeight: "500",
    marginLeft: 6,
    color: '#fff',
  },

  overlayContainer: {
    position: "absolute",
    width: "100%",
    top: 10,
    paddingHorizontal: 4,
    zIndex: 999,
  },

  dropdownBox: {
    backgroundColor: "#fff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d9d9d9",
    padding: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    elevation: 4,
  },

  searchWrapper: {
    position: "relative",
    marginTop: 10,
  },

  clearButton: {
    position: 'absolute',
    right: 12,
    paddingVertical: 14,
  },

  searchInput: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    height: 50,
  },

  dropdownList: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 10,
    marginTop: 5,
    maxHeight: 350,
  },

  item: {
    padding: 14,
    borderBottomWidth: 1,
    borderColor: "#eee",
  },

  itemText: {
    fontSize: 16,
  },
});

type LatLng = { latitude: number; longitude: number };

type GeoJSONFeature = {
  geometry: {
    type: "Polygon" | "MultiPolygon";
    // GeoJSON dùng [lng, lat]
    coordinates: number[][][] | number[][][][];
  };
  properties?: {
    [key: string]: any;
  };
};

type CommunePolygon = {
  id: string;
  name: string;
  // Một xã có thể gồm nhiều polygon (MultiPolygon)
  coordinates: LatLng[][];
  properties?: { [key: string]: any };
};

const rawFeatures = (mapData as any).features as GeoJSONFeature[];

const COMMUNE_POLYGONS: CommunePolygon[] = rawFeatures
  .map((feature, index) => {
    const { geometry, properties } = feature;

    let coordinates: LatLng[][] = [];

    if (geometry.type === "Polygon") {
      const rings = geometry.coordinates as number[][][];
      const outerRing = rings[0] ?? [];
      coordinates = [
        outerRing.map(([lng, lat]) => ({
          latitude: lat,
          longitude: lng,
        })),
      ];
    } else if (geometry.type === "MultiPolygon") {
      const polys = geometry.coordinates as number[][][][];
      coordinates = polys.map((poly) => {
        const outerRing = poly[0] ?? [];
        return outerRing.map(([lng, lat]) => ({
          latitude: lat,
          longitude: lng,
        }));
      });
    }

    const name =
      (properties && (properties.ten_xa || properties.name)) ||
      `Xã ${index + 1}`;

    const id =
      (properties &&
        (properties.ma_xa || properties.id || properties.code))?.toString() ??
      String(index);

    return {
      id,
      name,
      coordinates,
      properties,
    };
  })
  .filter((c) => c.coordinates.length > 0);

const ALL_COMMUNES = COMMUNE_POLYGONS.map((c) => c.name);

const MapScreen = () => {
  const mapRef = useRef<MapView | null>(null);
  const route = useRoute<any>();

  // Tính region khởi tạo từ polygon đầu tiên
  const firstPolygon = COMMUNE_POLYGONS[0];
  const firstPoint = firstPolygon?.coordinates[0];

  const initialRegion: Region = {
    latitude: firstPoint?.latitude ?? 11.6,
    longitude: firstPoint?.longitude ?? 107.7,
    latitudeDelta: 0.6,
    longitudeDelta: 0.6,
  };

  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [selected, setSelected] = useState("Chọn xã/phường");
  const [selectedCommune, setSelectedCommune] = useState<CommunePolygon | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [communeData, setCommuneData] = useState<Commune | null>(null);
  const [loadingCommune, setLoadingCommune] = useState(false);

  const initialMaXaFromRoute: string | undefined = route.params?.ma_xa;

  const filteredList = COMMUNE_POLYGONS.filter((c) =>
    c.name.toLowerCase().includes(keyword.toLowerCase())
  );

  const focusOnCommune = (commune: CommunePolygon) => {
    if (commune.coordinates.length === 0 || !mapRef.current) return;

    const allPoints = commune.coordinates.flat();
    if (allPoints.length === 0) return;

    const lats = allPoints.map((p) => p.latitude);
    const lngs = allPoints.map((p) => p.longitude);

    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    const region: Region = {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: (maxLat - minLat) * 1.5 || 0.05,
      longitudeDelta: (maxLng - minLng) * 1.5 || 0.05,
    };

    mapRef.current.animateToRegion(region, 500);
  };

  const handleSelectCommune = (commune: CommunePolygon) => {
    setSelected(commune.name);
    setSelectedCommune(commune);
    setOpen(false);
    focusOnCommune(commune);
  };

  const fetchCommuneData = async (maXa: string) => {
    try {
      setLoadingCommune(true);
      // Gọi API thay thế Firestore
      const envelope = await lookupByCode(maXa);
      if (envelope.locality) {
        // Ánh xạ LocalityResult -> Commune model để UI dùng tiếp
        const commune: Commune = {
          id: envelope.locality.code,
          ma_xa: envelope.locality.code,
          ten_xa: envelope.locality.name,
          name: envelope.locality.name,
          loai: envelope.locality.type,
          cap: 2,
          ma_tinh: 'LDG',
          ten_tinh: envelope.locality.provinceName || 'Lâm Đồng',
          dan_so: envelope.locality.population ?? 0,
          dtich_km2: envelope.locality.areaKm2 ?? 0,
          matdo_km2: 0,
          address: envelope.locality.address ?? '',
          tru_so: envelope.locality.stationAddress ?? envelope.locality.address ?? '',
          sap_nhap: '',
        };
        setCommuneData(commune);
      } else {
        setCommuneData(null);
      }
    } catch (error) {
      console.error('Error fetching commune data from API:', error);
      setCommuneData(null);
    } finally {
      setLoadingCommune(false);
    }
  };

  const handlePolygonPress = () => {
    if (selectedCommune) {
      const maXa = selectedCommune.properties?.ma_xa || selectedCommune.id;
      if (maXa) {
        fetchCommuneData(maXa.toString());
        setShowInfo(true);
      } else {
        setShowInfo(true);
      }
    }
  };

  const handleDirections = async (address: string) => {
    if (!address) {
      Alert.alert('Thông báo', 'Không có địa chỉ để chỉ đường');
      return;
    }

    try {
      // Encode địa chỉ để dùng trong URL
      const encodedAddress = encodeURIComponent(address);
      // URL Google Maps với chế độ chỉ đường
      const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodedAddress}`;
      
      const canOpenGoogleMaps = await Linking.canOpenURL(googleMapsUrl);
      if (canOpenGoogleMaps) {
        await Linking.openURL(googleMapsUrl);
      } else {
        // Nếu là iOS và không mở được Google Maps, mở Apple Maps
        if (Platform.OS === 'ios') {
          const appleMapsUrl = `http://maps.apple.com/?daddr=${encodedAddress}`;
          const canOpenAppleMaps = await Linking.canOpenURL(appleMapsUrl);
          if (canOpenAppleMaps) {
            await Linking.openURL(appleMapsUrl);
          } else {
            // Fallback: mở Google Maps web
            const webUrl = `https://maps.google.com/?daddr=${encodedAddress}`;
            await Linking.openURL(webUrl);
          }
        } else {
          // Android: mở Google Maps web
          const webUrl = `https://maps.google.com/?daddr=${encodedAddress}`;
          await Linking.openURL(webUrl);
        }
      }
    } catch (error) {
      console.error('Error opening directions:', error);
      Alert.alert('Lỗi', 'Không thể mở ứng dụng bản đồ. Vui lòng thử lại.');
    }
  };

  // Khi được điều hướng từ màn hình chi tiết xã, tự động focus và chọn xã theo ma_xa
  useEffect(() => {
    if (!initialMaXaFromRoute) return;

    const commune = COMMUNE_POLYGONS.find(
      (c) => c.properties?.ma_xa?.toString() === initialMaXaFromRoute.toString()
    );

    if (commune) {
      handleSelectCommune(commune);
    }
  }, [initialMaXaFromRoute]);

  return (
    <View style={styles.container}>
      {/* 🔍 Overlay Search */}
      <View style={styles.overlayContainer}>

        {/* Hộp chọn xã */}
        <TouchableOpacity
          style={styles.dropdownBox}
          onPress={() => setOpen(!open)}
          activeOpacity={1}
        >
          <Text style={{ fontSize: 16 }}>{selected}</Text>
          <AntDesign name={open ? "up" : "down"} size={18} />
        </TouchableOpacity>

        {/* Ô tìm kiếm */}
        {open && (
          <>
            <View style={styles.searchWrapper}>
              <TextInput
                placeholder="Tìm kiếm xã/phường..."
                style={styles.searchInput}
                value={keyword}
                onChangeText={setKeyword}
              />
              {keyword.length > 0 && (
                <TouchableOpacity
                  style={styles.clearButton}
                  onPress={() => setKeyword("")}
                >
                  <AntDesign name="close-circle" size={20} color="#999" />
                </TouchableOpacity>
              )}
            </View>

            {/* Danh sách */}
            <View style={styles.dropdownList}>
              <FlatList
                data={filteredList}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.item}
                    onPress={() => handleSelectCommune(item)}
                  >
                    <Text style={styles.itemText}>{item.name}</Text>
                  </TouchableOpacity>
                )}
              />
            </View>
          </>
        )}
      </View>

      {/* Bản đồ với polygon – chỉ hiển thị khi đã chọn xã để tránh lag */}
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={{ flex: 1 }}
        initialRegion={initialRegion}
      >
        {selectedCommune &&
          selectedCommune.coordinates.map((ring, idx) => (
            <Polygon
              key={`${selectedCommune.id}-${idx}`}
              coordinates={ring}
              tappable
              strokeWidth={2}
              strokeColor="#ffffff"
              fillColor="rgba(255, 87, 34, 0.55)"
              onPress={handlePolygonPress}
            />
          ))}
      </MapView>

      {/* Bottom sheet thông tin xã/phường */}
      <Modal
        visible={showInfo && !!selectedCommune}
        animationType="slide"
        transparent
        onRequestClose={() => {
          setShowInfo(false);
          setCommuneData(null);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.bottomSheet}>
            <View style={styles.sheetHeader}>
              <View style={styles.sheetHeaderSide} />
              <View style={styles.sheetTitleWrapper}>
                <Text style={styles.sheetTitle}>
                  {communeData?.ten_xa || selectedCommune?.name || "Xã/Phường"}
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.sheetHeaderSide, styles.sheetCloseButton]}
                onPress={() => {
                  setShowInfo(false);
                  setCommuneData(null);
                }}
              >
                <AntDesign name="close" size={22} color="#333" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {loadingCommune ? (
                <View style={{ padding: 40, alignItems: 'center', justifyContent: 'center' }}>
                  <ActivityIndicator size="large" color="#dc3545" />
                  <Text style={{ marginTop: 12, color: '#666' }}>Đang tải dữ liệu...</Text>
                </View>
              ) : (() => {
                // Ưu tiên dùng data từ API, nếu không có thì fallback về properties
                const dataSource = communeData || selectedCommune?.properties || {};

                // COMMUNE_SCHEMA fields - lấy từ API hoặc properties
                const danSo = communeData?.dan_so ?? dataSource.dan_so ?? null;
                const dienTich = communeData?.dtich_km2 ?? dataSource.dtich_km2 ?? null;
                const matDo = communeData?.matdo_km2 ?? dataSource.matdo_km2 ?? null;
                const diaChi = communeData?.address ?? dataSource.address ?? null;
                const truSo = communeData?.tru_so ?? dataSource.tru_so ?? null;
                const ghiChu = communeData?.sap_nhap ?? dataSource.sap_nhap ?? null;

                // CONTACT_SCHEMA fields - cần lấy từ ContactService nếu có
                const chief = dataSource.chief ?? null;
                const mobile = dataSource.mobile ?? null;

                const toaDo = dataSource.toa_do || "";

                return (
                  <>
                    {(danSo || dienTich) && (
                      <View style={styles.pillRow}>
                        {danSo && (
                          <View
                            style={[
                              styles.pill,
                              { backgroundColor: "#EFF3FF" },
                            ]}
                          >
                            <View
                              style={{
                                flexDirection: "row",
                                alignItems: "center",
                                marginBottom: 4,
                              }}
                            >
                              <Ionicons
                                name="people-sharp"
                                size={18}
                                color="#1f6feb"
                              />
                              <Text
                                style={[styles.pillLabel, { marginLeft: 6 }]}
                              >
                                Dân số
                              </Text>
                            </View>
                            <Text style={styles.pillValue}>
                              {danSo.toLocaleString("vi-VN")} người
                            </Text>
                          </View>
                        )}
                        {dienTich && (
                          <View
                            style={[
                              styles.pill,
                              {
                                backgroundColor: "#E7FAF3",
                                marginRight: 0,
                              },
                            ]}
                          >
                            <View
                              style={{
                                flexDirection: "row",
                                alignItems: "center",
                                marginBottom: 4,
                              }}
                            >
                              <Ionicons
                                name="earth"
                                size={18}
                                color="#389e0d"
                              />
                              <Text
                                style={[styles.pillLabel, { marginLeft: 6 }]}
                              >
                                Diện tích
                              </Text>
                            </View>
                            <Text style={styles.pillValue}>
                              {dienTich} km²
                            </Text>
                          </View>
                        )}
                      </View>
                    )}

                    {matDo && (
                      <View
                        style={[
                          styles.pill,
                          {
                            backgroundColor: "#FFF7E6",
                            marginRight: 0,
                            marginTop: 12,
                          },
                        ]}
                      >
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            marginBottom: 4,
                          }}
                        >
                          <Ionicons
                            name="business"
                            size={18}
                            color="#fa8c16"
                          />
                          <Text style={[styles.pillLabel, { marginLeft: 6 }]}>
                            Mật độ dân cư
                          </Text>
                        </View>
                        <Text style={styles.pillValue}>
                          {matDo} người/km²
                        </Text>
                      </View>
                    )}

                    {diaChi && (
                      <View style={styles.card}>
                        <View style={styles.rowWithIcon}>
                          <View style={styles.rowIconWrapper}>
                            <Entypo name="location" size={18} color="red" />
                          </View>
                        <View style={styles.rowTextWrapper}>
                          <Text style={styles.cardLabel}>
                            Địa chỉ trụ sở CA
                          </Text>
                          <Text style={styles.cardValue}>
                            {diaChi}
                          </Text>
                        </View>
                        <TouchableOpacity
                          style={styles.copyIconButton}
                          onPress={() => {
                            if (diaChi) {
                              Clipboard.setStringAsync(diaChi);
                            }
                          }}
                        >
                          <AntDesign name="copy" size={18} color="gray" />
                        </TouchableOpacity>
                        </View>
                      </View>
                    )}

                    <View style={styles.card}>
                      <View style={styles.rowWithIcon}>
                        <View style={styles.rowIconWrapper}>
                          <AntDesign name="pushpin" size={18} color="#faad14" />
                        </View>
                        <View style={styles.rowTextWrapper}>
                          <Text style={styles.cardLabel}>Tọa độ</Text>
                          <Text style={styles.cardValue}>
                            {toaDo ||
                              `${selectedCommune?.coordinates?.[0]?.[0]?.latitude?.toFixed(
                                6
                              )}, ${selectedCommune?.coordinates?.[0]?.[0]?.longitude?.toFixed(
                                6
                              )}`}
                          </Text>
                        </View>
                      </View>
                    </View>

                    {ghiChu && (
                      <View style={styles.card}>
                        <View style={styles.rowWithIcon}>
                          <View style={styles.rowIconWrapper}>
                            <FontAwesome name="sticky-note" size={18} color="pink" />
                          </View>
                          <View style={styles.rowTextWrapper}>
                            <Text style={styles.cardLabel}>Ghi chú</Text>
                            <Text style={styles.cardValue}>Sáp nhập: {ghiChu}</Text>
                          </View>
                        </View>
                      </View>
                    )}
                    {/* Tính năng tạm thời ko được phép sử dụng */}
                    {/* <TouchableOpacity 
                      style={styles.actionButton}
                      onPress={() => handleDirections(diaChi || '')}
                    >
                      <FontAwesome5 name="directions" size={18} color="orange" />
                      <Text style={styles.actionButtonText}>Chỉ đường</Text>
                    </TouchableOpacity> */}
                  </>
                );
              })()}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
};

export default MapScreen;