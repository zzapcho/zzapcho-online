# 런처 전용 접속 설계

## 결론

런처만으로는 `online.zzapcho.kr` 접속을 완전히 제한할 수 없습니다. 모드 방식은 사용자가 파일을 빼가거나 다른 런처에 옮길 수 있으므로 강한 통제 수단이 아닙니다.

런처 전용 접속은 서버 측 Paper 플러그인과 런처 백엔드 API가 함께 있어야 합니다.

## 권장 구조

```text
런처 로그인
  -> Microsoft/Minecraft 계정 확인
  -> 런처 백엔드에 일회성 접속 토큰 요청
  -> 런처가 게임 실행 시 토큰을 JVM argument 또는 로컬 핸드셰이크 방식으로 전달
  -> Paper 플러그인이 접속 플레이어 UUID와 토큰 검증
  -> 성공 시 입장 허용, 실패 시 kick
```

## 필요한 구성요소

### 1. 런처

- manifest SHA-256 검증
- 공식 파일만 다운로드
- 비공식 파일 quarantine
- 로그인된 Minecraft UUID 확인
- 서버 입장 직전 일회성 토큰 요청
- 토큰은 짧은 TTL로 사용하고 저장하지 않음

### 2. 백엔드 API

- 런처 버전 확인
- manifest 버전 확인
- Minecraft UUID 기준 일회성 토큰 발급
- 토큰 TTL 관리
- 토큰 1회 사용 처리

예시 API:

```text
POST https://api.zzapcho.kr/launcher/session
POST https://api.zzapcho.kr/launcher/verify
```

### 3. Paper 플러그인

- 플레이어 접속 시 UUID 확인
- 백엔드 API에 토큰 검증 요청
- 토큰 없음, 만료, 재사용, UUID 불일치 시 kick
- 서버 resource pack 또는 plugin message 채널을 보조 신호로 사용할 수 있음

## 왜 모드만으로는 부족한가

- 모드 파일은 복사할 수 있습니다.
- 다른 런처에서 같은 모드 조합으로 실행할 수 있습니다.
- 클라이언트 측 검사는 우회될 수 있습니다.
- 비밀값을 모드나 런처에 넣으면 추출될 수 있습니다.

## 현실적인 보안 수준

이 구조는 “일반 사용자가 다른 런처로 쉽게 들어오는 것”을 막는 데 효과적입니다. 다만 완전한 안티치트나 DRM은 아닙니다. 중요한 판정은 반드시 서버에서 해야 합니다.

## 다음 구현 단계

1. `api.zzapcho.kr`에 런처 세션 API 추가
2. Paper 플러그인 제작
3. 런처에서 게임 시작 직전 세션 토큰 요청
4. 서버 접속 시 Paper 플러그인에서 토큰 검증
5. 실패 시 명확한 kick 메시지 제공
