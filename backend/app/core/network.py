import ipaddress

from fastapi import Request


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "0.0.0.0"


def ip_allowed(ip: str, networks: list[str]) -> bool:
    if not networks:
        return True
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return any(addr in ipaddress.ip_network(n, strict=False) for n in networks)
