from app.models.enums import DeviceKind


def guess_kind(user_agent: str | None) -> DeviceKind:
    ua = (user_agent or "").lower()
    if "ipad" in ua or "tablet" in ua:
        return DeviceKind.TABLET
    if "mobi" in ua or "iphone" in ua or "android" in ua:
        return DeviceKind.CELULAR
    return DeviceKind.PC
