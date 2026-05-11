# 클라이언트 콘텐츠 관리

## 모드 추가

1. `.jar` 파일을 `content/client/mods`에 넣습니다.
2. `npm run manifest`를 실행합니다.
3. `npm run content:verify`로 검증합니다.
4. 변경 사항을 commit/push합니다.

## 리소스팩 추가

`.zip` 파일을 `content/client/resourcepacks`에 넣고 모드와 같은 절차를 따릅니다.

## 셰이더 추가

셰이더는 GitHub manifest 관리 대상이 아닙니다. 사용자가 런처의 셰이더 화면에서 파일 추가, 드래그앤드롭, Modrinth 설치로 자유롭게 관리합니다.

## config 관리

`config`는 GitHub manifest 관리 대상이 아닙니다. 런처는 `config` 폴더를 공식 파일 검증/quarantine 대상으로 보지 않습니다.

## profile.json 수정

`content/profile.json`에서 서버, Minecraft 버전, loader 버전, 런처 최소 버전, manifest 버전을 수정합니다. 사용자는 UI에서 이 값을 바꿀 수 없습니다.

## manifest 생성과 검증

```bash
npm run manifest
npm run content:verify
npm run content:summary
```

## 배포 흐름

1. content 파일 또는 profile 수정
2. manifest 생성
3. content 검증
4. commit
5. push
6. 런처가 새 manifest를 다운로드해 동기화
