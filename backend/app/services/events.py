import asyncio
import logging
from collections import defaultdict

log = logging.getLogger("helpdesk.events")


class EventBroker:
    """Distribuidor de eventos en memoria para SSE. Con varias réplicas, reemplazar por Redis Pub/Sub."""

    def __init__(self) -> None:
        self._subscribers: dict[str, set[asyncio.Queue]] = defaultdict(set)

    def subscribe(self, channels: list[str]) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=100)
        for ch in channels:
            self._subscribers[ch].add(queue)
        return queue

    def unsubscribe(self, channels: list[str], queue: asyncio.Queue) -> None:
        for ch in channels:
            self._subscribers[ch].discard(queue)
            if not self._subscribers[ch]:
                self._subscribers.pop(ch, None)

    async def publish(self, channel: str, event: dict) -> None:
        for queue in list(self._subscribers.get(channel, ())):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                log.warning("Cola SSE llena en canal %s; evento descartado", channel)


broker = EventBroker()
