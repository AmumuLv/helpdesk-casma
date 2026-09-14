from app.core.security import hash_password
from app.core.timeutil import utcnow
from app.models import SystemSetting

KEY = "office_access"


async def get_office_access() -> SystemSetting | None:
    return await SystemSetting.find_one(SystemSetting.key == KEY)


async def set_office_password(password: str) -> int:
    setting = await get_office_access()
    if setting is None:
        setting = SystemSetting(key=KEY, value={"version": 0})
    version = int(setting.value.get("version", 0)) + 1
    setting.value = {"password_hash": hash_password(password), "version": version, "updated_at": utcnow().isoformat()}
    setting.updated_at = utcnow()
    await setting.save()
    return version
