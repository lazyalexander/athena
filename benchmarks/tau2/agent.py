"""τ-bench message adapter. Domain tools remain owned by the official evaluator."""

import json
import os
from pathlib import Path
import shutil
import subprocess

from pydantic import BaseModel
from tau2.agent.base_agent import HalfDuplexAgent
from tau2.data_model.message import AssistantMessage, MultiToolMessage, ToolCall, UserMessage


class AthenaState(BaseModel):
    messages: list = []


class AthenaAgent(HalfDuplexAgent[AthenaState]):
    def __init__(self, tools, domain_policy):
        super().__init__(tools=tools, domain_policy=domain_policy)
        node = os.environ.get("ATHENA_NODE") or shutil.which("node")
        if not node:
            raise RuntimeError("Set ATHENA_NODE to a Node.js 26 executable")
        self.process = subprocess.Popen(
            [node, "--experimental-strip-types", str(Path(__file__).with_name("bridge.ts"))],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True,
        )

    def get_init_state(self, message_history=None):
        return AthenaState(messages=message_history or [])

    def generate_next_message(self, message, state):
        if isinstance(message, UserMessage):
            value = message.content or ""
        else:
            messages = message.tool_messages if isinstance(message, MultiToolMessage) else [message]
            value = [{"callId": item.id, "output": item.content or ""} for item in messages]
        definitions = []
        for tool in self.tools:
            schema = tool.openai_schema
            function = schema.get("function", schema)
            definitions.append({
                "name": function["name"], "description": function.get("description", ""),
                "parameters": function["parameters"],
            })
        self.process.stdin.write(json.dumps({"input": value, "tools": definitions, "policy": self.domain_policy}) + "\n")
        self.process.stdin.flush()
        reply = json.loads(self.process.stdout.readline())
        if "error" in reply:
            raise RuntimeError(reply["error"])
        step = reply["result"]
        if step["calls"]:
            output = AssistantMessage(role="assistant", tool_calls=[
                ToolCall(id=call["callId"], name=call["name"], arguments=json.loads(call["arguments"]))
                for call in step["calls"]
            ])
        else:
            output = AssistantMessage(role="assistant", content=step["text"] or "(No text response)")
        state.messages.append(output)
        return output, state

    def stop(self, message=None, state=None):
        if self.process.poll() is None:
            self.process.terminate()


def create_athena_agent(tools, domain_policy, **kwargs):
    return AthenaAgent(tools, domain_policy)
