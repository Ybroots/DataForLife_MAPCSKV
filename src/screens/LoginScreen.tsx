import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../services/apiClient';
import { APP_VERSION } from '../config/constants';

const PRIMARY_COLOR = '#dc3545';

interface LoginScreenProps {
  navigation: any;
}

type LoginMode = 'officer' | 'citizen';

export default function LoginScreen({ navigation }: LoginScreenProps) {
  const { loginOfficer, loginCitizen } = useAuth();
  const [mode, setMode] = useState<LoginMode>('officer');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    const trimmedUsername = username.trim();
    const trimmedPassword = password.trim();

    if (!trimmedUsername || !trimmedPassword) {
      Alert.alert('Thông báo', 'Vui lòng nhập đầy đủ tài khoản và mật khẩu.');
      return;
    }

    setLoading(true);
    try {
      if (mode === 'officer') {
        await loginOfficer(trimmedUsername, trimmedPassword);
      } else {
        await loginCitizen(trimmedUsername, trimmedPassword);
      }
      navigation.goBack();
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 401) {
          Alert.alert('Đăng nhập thất bại', 'Tài khoản hoặc mật khẩu không đúng.');
        } else if (error.status === 0) {
          Alert.alert(
            'Lỗi kết nối',
            'Không thể kết nối máy chủ. Kiểm tra kết nối Internet và thử lại.',
          );
        } else {
          Alert.alert('Lỗi', error.message || 'Đã xảy ra lỗi. Vui lòng thử lại.');
        }
      } else {
        Alert.alert('Lỗi', 'Đã xảy ra lỗi không xác định. Vui lòng thử lại.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Logo */}
        <View style={styles.logoContainer}>
          <Image
            source={require('../../assets/images/logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.appName}>DANH BẠ CÔNG AN LÂM ĐỒNG</Text>
        </View>

        {/* Chọn loại tài khoản */}
        <View style={styles.modeToggle}>
          <TouchableOpacity
            style={[styles.modeButton, mode === 'officer' && styles.modeButtonActive]}
            onPress={() => setMode('officer')}
          >
            <Text style={[styles.modeButtonText, mode === 'officer' && styles.modeButtonTextActive]}>
              Cán bộ
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeButton, mode === 'citizen' && styles.modeButtonActive]}
            onPress={() => setMode('citizen')}
          >
            <Text style={[styles.modeButtonText, mode === 'citizen' && styles.modeButtonTextActive]}>
              Công dân
            </Text>
          </TouchableOpacity>
        </View>

        {/* Form đăng nhập */}
        <View style={styles.formContainer}>
          <Text style={styles.label}>
            {mode === 'officer' ? 'Tên đăng nhập' : 'Số điện thoại / tên đăng nhập'}
          </Text>
          <TextInput
            style={styles.input}
            placeholder={mode === 'officer' ? 'Nhập tên đăng nhập' : 'Nhập số điện thoại'}
            keyboardType={mode === 'citizen' ? 'phone-pad' : 'default'}
            autoCapitalize="none"
            autoCorrect={false}
            value={username}
            onChangeText={setUsername}
            placeholderTextColor="#999"
            editable={!loading}
          />

          <Text style={styles.label}>Mật khẩu</Text>
          <TextInput
            style={styles.input}
            placeholder="Nhập mật khẩu"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            placeholderTextColor="#999"
            editable={!loading}
            onSubmitEditing={handleLogin}
            returnKeyType="done"
          />

          <TouchableOpacity
            style={[styles.loginButton, loading && styles.loginButtonDisabled]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.loginButtonText}>ĐĂNG NHẬP</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <TouchableOpacity onPress={() => navigation.navigate('PrivacyPolicy')}>
            <Text style={styles.privacyLink}>Điều khoản và Chính sách bảo mật</Text>
          </TouchableOpacity>
          <Text style={styles.versionFooter}>Phiên bản {APP_VERSION}</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logo: {
    width: 120,
    height: 120,
    marginBottom: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  appName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  modeToggle: {
    flexDirection: 'row',
    marginBottom: 24,
    borderWidth: 1,
    borderColor: PRIMARY_COLOR,
    borderRadius: 8,
    overflow: 'hidden',
  },
  modeButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  modeButtonActive: {
    backgroundColor: PRIMARY_COLOR,
  },
  modeButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: PRIMARY_COLOR,
  },
  modeButtonTextActive: {
    color: '#fff',
  },
  formContainer: {
    width: '100%',
  },
  label: {
    fontSize: 15,
    fontWeight: '500',
    color: '#333',
    marginBottom: 6,
    marginLeft: 2,
  },
  input: {
    height: 50,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 16,
    marginBottom: 18,
    fontSize: 16,
    backgroundColor: '#f9f9f9',
    color: '#333',
  },
  loginButton: {
    height: 50,
    backgroundColor: PRIMARY_COLOR,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
    shadowColor: PRIMARY_COLOR,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  loginButtonDisabled: {
    opacity: 0.6,
  },
  loginButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  footer: {
    marginTop: 36,
    alignItems: 'center',
    marginBottom: 20,
  },
  privacyLink: {
    color: PRIMARY_COLOR,
    textDecorationLine: 'underline',
    fontSize: 14,
    marginBottom: 8,
  },
  versionFooter: {
    fontSize: 12,
    color: '#999',
    fontStyle: 'italic',
  },
});
