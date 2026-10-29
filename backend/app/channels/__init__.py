from app.channels.base import ChannelAdapter
from app.channels.web import WebChatAdapter
from app.models import Channel

ADAPTERS: dict[Channel, ChannelAdapter] = {Channel.WEB: WebChatAdapter()}
