import { Component, type ErrorInfo, type PropsWithChildren } from 'react';

/** Keep a failed screen or lazy chunk from leaving the user on an empty page. */
export class ScreenErrorBoundary extends Component<PropsWithChildren, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Không thể hiển thị màn hình', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="feature-workspace" id="main-content">
        <section className="feature-page" role="alert" aria-labelledby="screen-error-title">
          <h1 id="screen-error-title">Chưa thể mở tính năng</h1>
          <p>Đã xảy ra lỗi khi tải giao diện. Bạn có thể tải lại trang hoặc trở về bản đồ.</p>
          <p>Nếu vừa gửi yêu cầu, hãy xem lại danh sách của bạn trước khi gửi lại.</p>
          <div className="screen-error-actions">
            <button className="back-button" type="button" onClick={() => window.location.reload()}>Tải lại trang</button>
            <a className="back-button" href="./">Về bản đồ</a>
          </div>
        </section>
      </main>
    );
  }
}
