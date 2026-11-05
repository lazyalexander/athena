"""Register Athena with an installed official τ-bench checkout, then invoke its CLI."""

from agent import create_athena_agent
from tau2.registry import registry

registry.register_agent_factory(create_athena_agent, "athena")

from tau2.cli import main  # noqa: E402

main()
