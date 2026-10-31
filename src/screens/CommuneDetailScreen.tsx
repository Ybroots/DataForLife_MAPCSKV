import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Commune } from '../models';

const CommuneDetailScreen = () => {
    const navigation = useNavigation<any>();
    const route = useRoute();
    const { communeInfo } = route.params as { communeInfo: Commune };

    return (
        <View style={styles.container}>
            <ScrollView style={styles.scrollView}>
                {/* Thông tin Section */}
                <View style={styles.section}>
                    <View style={styles.sectionHeader}>
                        <Text style={styles.sectionTitle}>Thông tin</Text>
                    </View>

                    <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Tên:</Text>
                        <Text style={styles.infoValue}>{communeInfo.ten_xa}</Text>
                    </View>

                    <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Dân số:</Text>
                        <Text style={styles.infoValue}>{communeInfo.dan_so != null ? `${communeInfo.dan_so.toLocaleString('vi-VN')} người` : 'Đang cập nhật'}</Text>
                    </View>

                    <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Diện tích:</Text>
                        <Text style={styles.infoValue}>{communeInfo.dtich_km2 != null ? `${communeInfo.dtich_km2.toLocaleString('vi-VN')} km²` : 'Đang cập nhật'}</Text>
                    </View>

                    <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Địa chỉ Trụ sở Công an:</Text>
                        <Text style={styles.infoValue}>{communeInfo.address}</Text>
                    </View>

                    {communeInfo.sap_nhap && communeInfo.sap_nhap !== 'đang cập nhật' && (
                        <View style={styles.infoRow}>
                            <Text style={styles.infoLabel}>Ghi chú:</Text>
                            <Text style={styles.infoValue}>Sáp nhập: {communeInfo.sap_nhap}</Text>
                        </View>
                    )}

                    {/* Button Xem vị trí trên bản đồ */}
                    <TouchableOpacity
                        style={styles.mapButton}
                        onPress={() => {
                            // Điều hướng sang tab "Bản đồ" và truyền mã xã để MapScreen focus
                            navigation.getParent()?.navigate('Bản đồ', {
                                screen: 'MapMain',
                                params: { ma_xa: communeInfo.ma_xa },
                            });
                        }}
                    >
                        <Text style={styles.mapButtonText}>Xem vị trí trên bản đồ</Text>
                    </TouchableOpacity>
                </View>

                {/* Bản đồ Section */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Bản đồ</Text>
                    <View style={styles.mapPlaceholder}>
                        <Text style={styles.placeholderText}>Hình ảnh bản đồ xã</Text>
                        <Text style={styles.placeholderSubtext}>(Đang cập nhật)</Text>
                    </View>
                </View>
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fff',
    },
    scrollView: {
        flex: 1,
    },
    section: {
        backgroundColor: 'white',
        margin: 15,
        borderRadius: 10,
        padding: 15,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
    },
    sectionHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 15,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: '#333',
        marginBottom: 10,
    },
    infoRow: {
        marginBottom: 12,
    },
    infoLabel: {
        fontSize: 14,
        fontWeight: '600',
        color: '#333',
        marginBottom: 4,
    },
    infoValue: {
        fontSize: 14,
        color: '#666',
        lineHeight: 20,
    },
    mapButton: {
        backgroundColor: '#dc3545',
        paddingVertical: 12,
        borderRadius: 8,
        alignItems: 'center',
        marginVertical: 15,
    },
    mapButtonText: {
        color: 'white',
        fontSize: 16,
        fontWeight: '600',
    },
    mapPlaceholder: {
        backgroundColor: '#f5f5f5',
        height: 300,
        borderRadius: 8,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#ddd',
        borderStyle: 'dashed',
    },
    placeholderText: {
        fontSize: 16,
        color: '#999',
        marginBottom: 5,
    },
    placeholderSubtext: {
        fontSize: 14,
        color: '#bbb',
    },
});

export default CommuneDetailScreen;
