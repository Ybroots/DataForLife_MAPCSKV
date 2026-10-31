import * as React from 'react';
import { Pressable, StatusBar, View, Text, Image, Dimensions, Alert, ActivityIndicator } from 'react-native';
import { NavigationContainer, useNavigation } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AntDesign from '@expo/vector-icons/AntDesign';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import ContactsScreen from './src/screens/ContactsScreen';
import MapScreen from './src/screens/MapScreen';
import CommuneDetailScreen from './src/screens/CommuneDetailScreen';
import PrivacyPolicyScreen from './src/screens/PrivacyPolicyScreen';
import LoginScreen from './src/screens/LoginScreen';
import { Commune } from './src/models';
import { AuthProvider, useAuth } from './src/context/AuthContext';

export type RootStackParamList = {
  // Main Tabs (Nested)
  MainTabs: undefined;

  // Auth & Overlays
  Login: undefined;
  PrivacyPolicy: undefined;
};

// Define param lists for the stack navigators inside tabs if needed, 
// or just reuse a broad type if we don't care about strict typing for this demo.
// For simplicity, mixing them, but cleaner to separate. 
// We will stick to the previous naming convention for stacks inside tabs.

export type ContactStackParamList = {
  ContactsList: undefined;
  CommuneDetail: { communeInfo: Commune };
  PrivacyPolicy: undefined; // Accessible from here too
  Login: undefined; // Accessible
};

export type MapStackParamList = {
  MapMain: undefined;
  PrivacyPolicy: undefined;
  Login: undefined;
};

const { width } = Dimensions.get('window');
const TAB_WIDTH = width / 2;

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator<ContactStackParamList>();
const MapStack = createNativeStackNavigator<MapStackParamList>();
const RootStack = createNativeStackNavigator<RootStackParamList>();

// Màu chủ đạo của app
const PRIMARY_COLOR = '#dc3545';

// Button Login/Logout logic reused
const HeaderRightButton = ({ navigation }: { navigation: any }) => {
  const { isLoggedIn, isLoading, session, logout } = useAuth();

  const handlePress = () => {
    if (isLoggedIn) {
      Alert.alert('Đăng xuất', 'Bạn có chắc chắn muốn đăng xuất?', [
        { text: 'Hủy', style: 'cancel' },
        {
          text: 'Đồng ý',
          onPress: () => {
            logout().catch(() => {});
          }
        }
      ]);
    } else {
      navigation.navigate('Login');
    }
  };

  if (isLoading) {
    return <ActivityIndicator color="#fff" style={{ marginRight: 8 }} />;
  }

  const displayName = session ? (session.displayName || session.username) : null;

  return (
    <Pressable onPress={handlePress} style={{ padding: 8, flexDirection: 'row', alignItems: 'center' }}>
      {displayName && (
        <Text style={{ color: '#fff', fontSize: 12, marginRight: 4 }} numberOfLines={1}>
          {displayName}
        </Text>
      )}
      <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600', marginRight: 5 }}>
        {isLoggedIn ? 'Đăng xuất' : 'Đăng nhập'}
      </Text>
      <AntDesign name={isLoggedIn ? "logout" : "login"} size={18} color="#fff" />
    </Pressable>
  );
};

// ===========================
// Contacts Stack
// ===========================
function ContactsStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: PRIMARY_COLOR },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '600', fontSize: 20 },
      }}
    >
      <Stack.Screen
        name="ContactsList"
        component={ContactsScreen}
        options={({ navigation }) => ({
          headerTitle: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Image
                source={require('./assets/images/logo.png')}
                style={{ width: 30, height: 30, marginRight: 8, borderRadius: 6 }}
                resizeMode="contain"
              />
              <Text style={{ color: '#fff', fontSize: 18, fontWeight: '600' }}>
                Công an tỉnh Lâm Đồng
              </Text>
            </View>
          ),
          headerTitleAlign: 'left',
          headerRight: () => <HeaderRightButton navigation={navigation} />,
        })}
      />

      <Stack.Screen
        name="CommuneDetail"
        component={CommuneDetailScreen}
        options={({ route, navigation }) => ({
          title: `Chi tiết ${route.params?.communeInfo?.ten_xa || ''}`,
          headerBackVisible: false,
          headerLeft: () => (
            <Pressable onPress={() => navigation.goBack()} style={{ paddingRight: 20 }}>
              <AntDesign name="arrow-left" size={24} color="#fff" />
            </Pressable>
          ),
        })}
      />

      {/* Keep PrivacyPolicy here if needed for direct functional navigation inside stack */}
      <Stack.Screen
        name="PrivacyPolicy"
        component={PrivacyPolicyScreen}
        options={({ navigation }) => ({
          title: 'Chính sách quyền riêng tư',
          headerBackVisible: false,
          headerLeft: () => (
            <Pressable onPress={() => navigation.goBack()} style={{ paddingRight: 20 }}>
              <AntDesign name="arrow-left" size={24} color="#fff" />
            </Pressable>
          ),
        })}
      />
    </Stack.Navigator>
  );
}


// ===========================
// Map Stack
// ===========================
function MapStackScreen() {
  return (
    <MapStack.Navigator
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: PRIMARY_COLOR },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '600', fontSize: 20 },
      }}
    >
      <MapStack.Screen
        name="MapMain"
        component={MapScreen}
        options={({ navigation }) => ({
          headerTitle: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Image
                source={require('./assets/images/logo.png')}
                style={{ width: 30, height: 30, marginRight: 8, borderRadius: 6 }}
                resizeMode="contain"
              />
              <Text style={{ color: '#fff', fontSize: 18, fontWeight: '600' }}>
                Công an tỉnh Lâm Đồng
              </Text>
            </View>
          ),
          headerTitleAlign: 'left',
          headerRight: () => <HeaderRightButton navigation={navigation} />,
        })}
      />

      {/* PrivacyPolicy in Map Stack too */}
      <MapStack.Screen
        name="PrivacyPolicy"
        component={PrivacyPolicyScreen}
        options={({ navigation }) => ({
          title: 'Chính sách quyền riêng tư',
          headerBackVisible: false,
          headerLeft: () => (
            <Pressable onPress={() => navigation.goBack()} style={{ paddingRight: 20 }}>
              <AntDesign name="arrow-left" size={24} color="#fff" />
            </Pressable>
          ),
        })}
      />
    </MapStack.Navigator>
  );
}


// ===========================
// Main Tabs
// ===========================
function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: PRIMARY_COLOR,
        tabBarInactiveTintColor: 'gray',
        tabBarStyle: {
          height: 80,
          paddingBottom: 15,
          paddingTop: 0,
          borderTopWidth: 1,
          borderTopColor: '#e0e0e0',
          backgroundColor: '#fff',
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
          marginTop: 5,
        },
        tabBarIcon: ({ color, size, focused }) => {
          let icon;
          if (route.name === 'Danh bạ') {
            icon = <AntDesign name="contacts" size={size} color={color} />;
          } else if (route.name === 'Bản đồ') {
            icon = <FontAwesome name="map-o" size={size} color={color} />;
          }

          return (
            <View style={{
              alignItems: 'center',
              justifyContent: 'center',
              width: TAB_WIDTH,
              height: '100%',
            }}>
              {focused && (
                <View style={{
                  position: 'absolute',
                  top: -6,
                  height: 3,
                  width: '100%',
                  backgroundColor: PRIMARY_COLOR,
                }} />
              )}
              {icon}
            </View>
          );
        },
      })}
    >
      <Tab.Screen name="Danh bạ" component={ContactsStack} />
      <Tab.Screen name="Bản đồ" component={MapStackScreen} />
    </Tab.Navigator>
  );
}

// ===========================
// App Entry
// ===========================
function AppContent() {
  // We can use hooks here if needed, but RootStack handles navigation
  return (
    <NavigationContainer>
      <RootStack.Navigator screenOptions={{ headerShown: false }}>
        <RootStack.Screen name="MainTabs" component={MainTabs} />
        <RootStack.Screen name="Login" component={LoginScreen} />
        {/* We can also have PrivacyPolicy here if we want a global modal, 
            but strictly speaking it's already in the stacks. 
            If navigating from LoginScreen, we need it here or LoginScreen needs to be part of a stack that has it.
        */}
        <RootStack.Screen
          name="PrivacyPolicy"
          component={PrivacyPolicyScreen}
          options={({ navigation }) => ({
            headerShown: true,
            headerStyle: { backgroundColor: PRIMARY_COLOR },
            headerTintColor: '#fff',
            title: 'Chính sách quyền riêng tư',
            headerLeft: () => (
              <Pressable onPress={() => navigation.goBack()} style={{ paddingRight: 20 }}>
                <AntDesign name="arrow-left" size={24} color="#fff" />
              </Pressable>
            ),
          })}
        />
      </RootStack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar backgroundColor={PRIMARY_COLOR} barStyle="light-content" />
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
