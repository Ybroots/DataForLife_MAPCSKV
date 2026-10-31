// @ts-nocheck
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, TextInput, Linking, ImageBackground, ActivityIndicator, Alert } from 'react-native';
import AntDesign from '@expo/vector-icons/AntDesign';
import Feather from '@expo/vector-icons/Feather';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Contacts from 'expo-contacts';
import { getAllContactsWithCommunes, loadAreaContacts, deleteContact } from '../services';
import type { ContactWithCommune } from '../models';
import { APP_VERSION } from '../config/constants';

type RootStackParamList = {
    ContactsList: undefined;
    CommuneDetail: { communeInfo: any };
};

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const ContactsScreen = () => {
    const navigation = useNavigation<NavigationProp>();
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [expandedCategory, setExpandedCategory] = useState<string | null>(null); // 'tinh', 'phong', 'xa'
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [contacts, setContacts] = useState<ContactWithCommune[]>([]);
    const [loading, setLoading] = useState(true);
    // Địa bàn đã/đang tải đầu mối (mục giữ chỗ chỉ có tên địa bàn)
    const [loadedAreas, setLoadedAreas] = useState<Set<string>>(new Set());
    const [loadingAreas, setLoadingAreas] = useState<Set<string>>(new Set());

    // Load contacts từ API
    useEffect(() => {
        loadContacts();
    }, []);

    const loadContacts = async () => {
        try {
            setLoading(true);
            const data = await getAllContactsWithCommunes();
            setContacts(data);
        } catch (error) {
            console.error('Error loading contacts:', error);
            Alert.alert('Lỗi', 'Không thể tải danh sách liên hệ');
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteContact = async (id: string, fullName: string) => {
        Alert.alert(
            'Xác nhận xóa',
            `Bạn có chắc muốn xóa "${fullName}"?`,
            [
                { text: 'Hủy', style: 'cancel' },
                {
                    text: 'Xóa',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await deleteContact(id);
                            loadContacts(); // Refresh danh sách
                            Alert.alert('Thành công', 'Đã xóa liên hệ');
                        } catch (error) {
                            Alert.alert('Lỗi', 'Không thể xóa liên hệ');
                        }
                    }
                }
            ]
        );
    };

    // Filter và group contacts theo ma_xa cho từng category
    const getFilteredContactsByCategory = (categoryContacts: ContactWithCommune[]) => {
        // Group toàn bộ contacts theo ma_xa
        const grouped = new Map<string, ContactWithCommune[]>();
        categoryContacts.forEach((contact) => {
            const maXa = String(contact.ma_xa || '').trim() || 'unknown';
            if (!grouped.has(maXa)) grouped.set(maXa, []);
            grouped.get(maXa)!.push(contact);
        });

        const query = searchQuery.toLowerCase();

        // Từ mỗi nhóm ma_xa, chọn 1 contact đại diện để hiển thị
        const groupsAsContacts: ContactWithCommune[] = [];

        grouped.forEach((group, maXa) => {
            if (group.length === 0) return;

            // Kiểm tra group có match search không (theo tên, mã xã, tên xã, tên tỉnh)
            const matchesGroup = group.some((c) =>
                c.fullName.toLowerCase().includes(query) ||
                String(c.ma_xa || '').toLowerCase().includes(query) ||
                (c.ten_xa || c.communeInfo?.ten_xa || '').toLowerCase().includes(query) ||
                (c.communeInfo?.ten_tinh || '').toLowerCase().includes(query)
            );

            if (!matchesGroup && query.length > 0) return;

            // Chọn bản ghi đầu tiên làm đại diện
            groupsAsContacts.push(group[0]);
        });

        // Sort: EMERGENCY* lên đầu, sau đó theo tên xã
        return groupsAsContacts.sort((a, b) => {
            const aIsEmergency = String(a.ma_xa || '').toUpperCase().includes('EMERGENCY');
            const bIsEmergency = String(b.ma_xa || '').toUpperCase().includes('EMERGENCY');

            if (aIsEmergency && !bIsEmergency) return -1;
            if (!aIsEmergency && bIsEmergency) return 1;

            const aTenXa = a.ten_xa || a.communeInfo?.ten_xa || '';
            const bTenXa = b.ten_xa || b.communeInfo?.ten_xa || '';
            return aTenXa.localeCompare(bTenXa, 'vi');
        });
    };

    // Group contacts theo cap (cấp)
    const contactsByCap = useMemo(() => {
        const capTinh: ContactWithCommune[] = [];   // Cấp tỉnh  => cap === 3
        const capPhong: ContactWithCommune[] = [];  // Cấp phòng => cap === 1
        const capXa: ContactWithCommune[] = [];     // Cấp xã    => cap === 2

        contacts.forEach((contact) => {
            const cap = contact.communeInfo?.cap;
            if (cap === 3) {
                capTinh.push(contact);
            } else if (cap === 1) {
                capPhong.push(contact);
            } else if (cap === 2) {
                capXa.push(contact);
            } else {
                // Không có cap rõ ràng: gom về cấp xã/phường cho dễ tìm
                capXa.push(contact);
            }
        });

        return { capTinh, capPhong, capXa };
    }, [contacts]);

    // Group contacts theo ma_xa để hiển thị khi expand
    const contactsByMaXa = useMemo(() => {
        const grouped = new Map<string, ContactWithCommune[]>();
        contacts.forEach((contact) => {
            // Normalize ma_xa: convert sang string, trim và đảm bảo không null/undefined
            const maXa = String(contact.ma_xa || '').trim() || 'unknown';
            if (!grouped.has(maXa)) {
                grouped.set(maXa, []);
            }
            grouped.get(maXa)!.push(contact);
        });
        
        return grouped;
    }, [contacts]);

    const normalizePhone = useCallback((mobile: string) => {
        return mobile.replace(/\./g, '').replace(/\-/g, '').replace(/\s/g, '');
    }, []);

    const handleSaveContact = useCallback(async (contact: ContactWithCommune) => {
        if (!contact.mobile) {
            Alert.alert('Thông báo', 'Liên hệ này chưa có số điện thoại để lưu');
            return;
        }

        const { status } = await Contacts.requestPermissionsAsync();
        if (status !== 'granted') {
            Alert.alert('Quyền truy cập', 'Ứng dụng cần quyền truy cập danh bạ để lưu liên hệ');
            return;
        }

        const phoneNumber = normalizePhone(contact.mobile);
        const communeName = contact.communeInfo?.ten_xa || contact.ten_xa || '';
        const baseName = contact.fullName || 'Liên hệ CA';
        const finalName = communeName ? `${baseName} ${communeName}` : baseName;

        try {
            await Contacts.addContactAsync({
                [Contacts.Fields.FirstName]: finalName,
                note: contact.communeInfo?.ten_tinh
                    ? `Công an ${contact.communeInfo.ten_tinh}`
                    : 'Liên hệ Công an địa phương',
                [Contacts.Fields.PhoneNumbers]: [
                    { label: 'mobile', number: phoneNumber },
                ],
            });
            Alert.alert('Thành công', 'Đã lưu vào danh bạ điện thoại');
        } catch (error) {
            console.error('Error saving contact to phonebook:', error);
            Alert.alert('Lỗi', 'Không thể lưu liên hệ vào danh bạ');
        }
    }, [normalizePhone]);

    const handleCall = useCallback((mobile: string | null | undefined) => {
        if (!mobile) return;
        const phoneNumber = normalizePhone(mobile);
        Linking.openURL(`tel:${phoneNumber}`);
    }, [normalizePhone]);

    const handleToggleExpand = useCallback((itemId: string | null, placeholderCode?: string) => {
        setExpandedId(prev => prev === itemId ? null : itemId);
        if (!placeholderCode || loadedAreas.has(placeholderCode) || loadingAreas.has(placeholderCode)) return;
        setLoadingAreas(prev => new Set(prev).add(placeholderCode));
        loadAreaContacts(placeholderCode)
            .then((areaContacts) => {
                setContacts(prev => [...prev, ...areaContacts]);
                setLoadedAreas(prev => new Set(prev).add(placeholderCode));
            })
            .catch(() => Alert.alert('Lỗi', 'Không thể tải liên hệ của địa bàn này. Kiểm tra kết nối và thử lại.'))
            .finally(() => setLoadingAreas(prev => { const next = new Set(prev); next.delete(placeholderCode); return next; }));
    }, [loadedAreas, loadingAreas]);

    const renderItem = useCallback(({ item, isInCategory = false }: { item: ContactWithCommune; isInCategory?: boolean }) => {
        const isExpanded = item.id === expandedId;
        // Lấy tất cả contacts có cùng ma_xa (normalize để đảm bảo khớp)
        const maXa = String(item.ma_xa || '').trim() || 'unknown';
        const sameMaXaContacts = contactsByMaXa.get(maXa) || [];
        // Lấy ten_xa: ưu tiên từ Contact.ten_xa, sau đó từ communeInfo.ten_xa
        const firstContactWithTenXa = sameMaXaContacts.find(c => c.ten_xa || c.communeInfo?.ten_xa) || sameMaXaContacts[0] || item;
        const tenXa = firstContactWithTenXa?.ten_xa || firstContactWithTenXa?.communeInfo?.ten_xa || item.ten_xa || item.communeInfo?.ten_xa || '';
        // Lấy ten_tinh: tìm từ tất cả contacts trong nhóm, ưu tiên contact có communeInfo đầy đủ
        const contactWithTenTinh = sameMaXaContacts.find(c => c.communeInfo?.ten_tinh) || item;
        const tenTinh = contactWithTenTinh?.communeInfo?.ten_tinh || item.communeInfo?.ten_tinh || '';
        // Lấy cap từ communeInfo để kiểm tra có hiển thị nút chi tiết không
        // Tìm contact có communeInfo với cap được định nghĩa
        const contactWithCap = sameMaXaContacts.find(c => c.communeInfo && c.communeInfo.cap !== undefined) || item;
        const capValue = contactWithCap?.communeInfo?.cap;
        // Convert cap sang number để so sánh (có thể là string hoặc number)
        const cap = capValue !== undefined ? Number(capValue) : undefined;
        // Kiểm tra có communeInfo không (nếu không có thì là phòng ban/số điện thoại chung, không hiển thị nút)
        const communeInfo = contactWithCap?.communeInfo || item.communeInfo;
        const hasCommuneInfo = !!communeInfo;

        const handleViewDetail = () => {
            // Lấy communeInfo từ contact có communeInfo đầy đủ trong nhóm
            const contactWithCommuneInfo = sameMaXaContacts.find(c => c.communeInfo) || item;
            const communeInfoToShow = contactWithCommuneInfo?.communeInfo || communeInfo;

            if (communeInfoToShow?.ma_xa) {
                // Điều hướng sang tab "Bản đồ" và truyền mã xã để MapScreen focus
                navigation.getParent()?.navigate('Bản đồ', {
                    screen: 'MapMain',
                    params: { ma_xa: communeInfoToShow.ma_xa },
                });
            } else {
                Alert.alert('Thông báo', 'Không có thông tin vị trí bản đồ cho xã này');
            }
        };

        return (
            <TouchableOpacity
                style={[styles.card, isInCategory && styles.cardInCategory]}
                activeOpacity={1}
                onPress={() => handleToggleExpand(item.id || null, item.placeholder ? item.ma_xa : undefined)}
            >
                <View style={styles.cardHeader}>
                    <View style={styles.nameContainer}>
                        <AntDesign 
                            name={isExpanded ? "down" : "right"} 
                            size={16} 
                            color="#333" 
                            style={styles.icon} 
                        />
                        <View style={styles.textContainer}>
                            <Text style={styles.name}>{`${tenXa}`}</Text>
                            <Text style={styles.addressPreview} numberOfLines={1}>
                                {tenXa ? (tenTinh ? `${tenXa}, ${tenTinh}` : tenXa) : ''}
                            </Text>
                        </View>
                    </View>
                    {/* Chỉ hiển thị nút xem chi tiết cho cấp xã (cap === 2) */}
                    {hasCommuneInfo && cap === 2 && item.placeholder && (
                        <View style={styles.rightActions}>
                            <TouchableOpacity onPress={handleViewDetail}>
                                <AntDesign name="right-circle" size={24} color="red" />
                            </TouchableOpacity>
                        </View>
                    )}
                </View>
                
                {isExpanded && (
                    <View style={styles.infoContainer}>
                        {/* Hiển thị tất cả contacts có cùng ma_xa */}
                        {loadingAreas.has(maXa) && (
                            <ActivityIndicator size="small" color="#dc3545" style={{ marginVertical: 8 }} />
                        )}
                        {!loadingAreas.has(maXa) && item.placeholder && loadedAreas.has(maXa) && sameMaXaContacts.every(c => c.placeholder) && (
                            <Text style={styles.noPhoneText}>Địa bàn này chưa có đầu mối công khai.</Text>
                        )}
                        {sameMaXaContacts.some(c => !c.placeholder) && (
                            <>
                                {[...sameMaXaContacts.filter(c => !c.placeholder)]
                                    .sort((a, b) => {
                                        const getRank = (name: string) => {
                                            const n = name.toLowerCase();
                                            if (n.includes('trưởng') && !n.includes('phó')) return 1;
                                            if (n.includes('phó')) return 2;
                                            return 3;
                                        };
                                        return getRank(a.fullName || '') - getRank(b.fullName || '');
                                    })
                                    .map((contact, index) => (
                                        <View key={contact.id || index} style={styles.contactItem}>
                                            <View style={styles.chiefContainer}>
                                                <View style={styles.chiefInfo}>
                                                    <View style={styles.nameRow}>
                                                        <Text style={styles.chiefName}>{contact.fullName || 'Chưa có tên'}</Text>
                                                    </View>
                                                {contact.mobile ? (
                                                    <Text style={styles.phoneNumber}>{contact.mobile}</Text>
                                                ) : (
                                                    <Text style={styles.noPhoneText}>Chưa có số điện thoại</Text>
                                                )}
                                            </View>
                                            {contact.mobile && (
                                                <View style={styles.actionButtons}>
                                                    <TouchableOpacity 
                                                        onPress={() => handleCall(contact.mobile)}
                                                        style={styles.phoneIconButton}
                                                    >
                                                        <Feather name="phone" size={24} color="red" style={{ transform: [{ scaleX: -1 }] }} />
                                                    </TouchableOpacity>
                                                    <TouchableOpacity
                                                        onPress={() => handleSaveContact(contact)}
                                                        style={styles.saveIconButton}
                                                    >
                                                        <Feather name="save" size={22} color="#007AFF" />
                                                    </TouchableOpacity>
                                                </View>
                                            )}
                                        </View>
                                    </View>
                                ))}
                            </>
                        )}
                    </View>
                )}
            </TouchableOpacity>
        );
    }, [expandedId, contactsByMaXa, handleCall, handleSaveContact, handleToggleExpand, navigation, loadedAreas, loadingAreas]);

    if (loading) {
        return (
            <View style={[styles.container, styles.centerContent]}>
                <ActivityIndicator size="large" color="#dc3545" />
                <Text style={styles.loadingText}>Đang tải...</Text>
            </View>
        );
    }

    // Render category header (item lớn)
    const renderCategoryHeader = (category: string, title: string) => {
        const isExpanded = expandedCategory === category;
        const categoryContacts = category === 'tinh' ? contactsByCap.capTinh : 
                                category === 'phong' ? contactsByCap.capPhong : 
                                contactsByCap.capXa;
        const filteredCategoryContacts = getFilteredContactsByCategory(categoryContacts);
        const displayCount = filteredCategoryContacts.length;

        return (
            <View style={styles.categoryCard}>
                <TouchableOpacity
                    style={styles.categoryHeader}
                    activeOpacity={0.7}
                    onPress={() => setExpandedCategory(isExpanded ? null : category)}
                >
                    <View style={styles.categoryHeaderLeft}>
                        <AntDesign 
                            name={isExpanded ? "down" : "right"} 
                            size={20} 
                            color="#dc3545" 
                            style={styles.categoryIcon} 
                        />
                        <Text style={styles.categoryTitle}>{title}</Text>
                    </View>
                    {/* Cấp tỉnh không hiển thị số lượng */}
                    {displayCount > 0 && category !== 'tinh' && (
                        <View style={styles.categoryBadge}>
                            <Text style={styles.categoryBadgeText}>{displayCount}</Text>
                        </View>
                    )}
                </TouchableOpacity>

                {isExpanded && (
                    <View style={styles.categoryContent}>
                        {filteredCategoryContacts.length > 0 ? (
                            filteredCategoryContacts.map((item, index) => (
                                <View key={item.id || `category-${category}-${index}`}>
                                    {renderItem({ item, isInCategory: true })}
                                </View>
                            ))
                        ) : (
                            <View style={styles.emptyCategoryContainer}>
                                <Text style={styles.emptyCategoryText}>
                                    {searchQuery ? 'Không tìm thấy kết quả' : 'Chưa có liên hệ nào'}
                                </Text>
                            </View>
                        )}
                    </View>
                )}
            </View>
        );
    };

    return (
        <ImageBackground
            source={require('../../assets/images/bg.png')}
            style={styles.container}
            resizeMode="cover"
            imageStyle={{ opacity: 0.2 }}
        >
            <Text style={styles.header}>Danh bạ điện thoại</Text>
            <View style={styles.searchContainer}>
                <TextInput
                    style={styles.searchBar}
                    placeholder="Nhập tên đơn vị, xã, phường, đặc khu, đồn"
                    value={searchQuery}
                    onChangeText={(text) => setSearchQuery(text)}
                />
                
                {searchQuery.length > 0 && (
                    <TouchableOpacity 
                        style={styles.clearButton}
                        onPress={() => setSearchQuery('')}
                    >
                        <AntDesign name="close-circle" size={20} color="#999" />
                    </TouchableOpacity>
                )}
            </View>
            <FlatList
                style={{ flex: 1 }}
                data={[
                    { type: 'category', category: 'tinh', title: 'Cấp tỉnh' },
                    { type: 'category', category: 'phong', title: 'Cấp phòng' },
                    { type: 'category', category: 'xa', title: 'Cấp xã/phường/đặc khu/đồn' },
                ]}
                keyExtractor={(item, index) => item.category || index.toString()}
                renderItem={({ item }) => 
                    renderCategoryHeader(item.category, item.title)
                }
                removeClippedSubviews={true}
                maxToRenderPerBatch={10}
                updateCellsBatchingPeriod={50}
                initialNumToRender={3}
                windowSize={10}
                ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                        <Text style={styles.emptyText}>Chưa có liên hệ nào</Text>
                    </View>
                }
                ListFooterComponent={
                    <View style={styles.footerContainer}>
                        <TouchableOpacity 
                            onPress={() => navigation.navigate('PrivacyPolicy')}
                            style={styles.footerLink}
                        >
                            <Text style={styles.footerLinkText}>Điều khoản và Chính sách bảo mật</Text>
                        </TouchableOpacity>
                        <View style={styles.versionContainer}>
                            <Text style={styles.versionText}>Phiên bản {APP_VERSION}</Text>
                        </View>
                    </View>
                }
            />
        </ImageBackground>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: 'transparent',
        padding: 10,
    },
    centerContent: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    loadingText: {
        marginTop: 10,
        fontSize: 16,
        color: '#666',
    },
    header: {
        fontSize: 22,
        fontWeight: 'bold',
        marginBottom: 10,
    },
    searchContainer: {
        position: 'relative',
        marginBottom: 10,
    },
    searchBar: {
        backgroundColor: 'white',
        borderRadius: 8,
        padding: 10,
        paddingRight: 40,
        height: 50
    },
    clearButton: {
        position: 'absolute',
        right: 12,
        paddingVertical: 14,
    },
    card: {
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        borderRadius: 10,
        padding: 16,
        marginBottom: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
    },
    cardInCategory: {
        marginBottom: 8,
        backgroundColor: '#fff',
    },
    cardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    nameContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    textContainer: {
        flex: 1,
    },
    rightActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    phoneButton: {
        padding: 4,
    },
    icon: {
        marginRight: 8,
    },
    infoContainer: {
        marginTop: 12,
        paddingLeft: 24,
    },
    address: {
        fontSize: 14,
        color: '#666',
        marginBottom: 12,
        lineHeight: 20,
    },
    chiefContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    chiefInfo: {
        flex: 1,
    },
    chiefName: {
        fontSize: 15,
        fontWeight: '600',
        color: '#333',
        marginBottom: 4,
    },
    phoneNumber: {
        fontSize: 14,
        color: '#007AFF',
    },
    phoneIconButton: {
        padding: 8,
        marginLeft: 12,
    },
    name: {
        fontWeight: '600',
        fontSize: 16,
        color: '#333',
    },
    addressPreview: {
        color: '#999',
        fontSize: 13,
        marginTop: 2,
    },
    divider: {
        height: 1,
        backgroundColor: '#e0e0e0',
        marginVertical: 12,
    },
    sectionTitle: {
        fontSize: 15,
        fontWeight: '600',
        color: '#007AFF',
        marginBottom: 8,
    },
    infoRow: {
        flexDirection: 'row',
        marginBottom: 6,
    },
    infoLabel: {
        fontSize: 14,
        color: '#666',
        width: 110,
        fontWeight: '500',
    },
    infoValue: {
        fontSize: 14,
        color: '#333',
        flex: 1,
    },
    deleteButton: {
        backgroundColor: '#ff3b30',
        padding: 10,
        borderRadius: 6,
        alignItems: 'center',
        marginTop: 12,
    },
    deleteButtonText: {
        color: 'white',
        fontWeight: '600',
    },
    emptyContainer: {
        padding: 40,
        alignItems: 'center',
    },
    emptyText: {
        fontSize: 16,
        color: '#999',
    },
    contactItem: {
        marginBottom: 12,
        paddingBottom: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#e0e0e0',
    },
    actionButtons: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    saveIconButton: {
        padding: 8,
        marginLeft: 4,
    },
    nameRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    contactLabel: {
        fontSize: 12,
        color: '#dc3545',
        backgroundColor: '#ffe0e0',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
        fontWeight: '600',
    },
    noPhoneText: {
        fontSize: 13,
        color: '#999',
        fontStyle: 'italic',
    },
    categoryCard: {
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        borderRadius: 12,
        marginBottom: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
        overflow: 'hidden',
    },
    categoryHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 18,
        backgroundColor: '#f8f9fa',
    },
    categoryHeaderLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    categoryIcon: {
        marginRight: 12,
    },
    categoryTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: '#dc3545',
    },
    categoryBadge: {
        backgroundColor: '#dc3545',
        borderRadius: 12,
        paddingHorizontal: 10,
        paddingVertical: 4,
        minWidth: 40,
        alignItems: 'center',
    },
    categoryBadgeText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '600',
    },
    categoryContent: {
        padding: 8,
    },
    emptyCategoryContainer: {
        padding: 20,
        alignItems: 'center',
    },
    emptyCategoryText: {
        fontSize: 14,
        color: '#999',
        fontStyle: 'italic',
    },
    versionContainer: {
        alignItems: 'center',
        marginTop: 5,
    },
    versionText: {
        fontSize: 12,
        color: '#999',
        fontStyle: 'italic',
    },
    footerContainer: {
        paddingVertical: 30,
        paddingBottom: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },
    footerLink: {
        paddingVertical: 5,
    },
    footerLinkText: {
        color: '#dc3545',
        fontSize: 13,
        textDecorationLine: 'underline',
    },
});

export default ContactsScreen;
