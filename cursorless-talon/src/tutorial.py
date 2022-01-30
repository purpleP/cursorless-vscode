import json
import re
from typing import Callable

from talon import actions, app, registry
from .actions.actions import ACTION_LIST_NAMES
from .modifiers.containing_scope import SCOPE_LIST_NAMES
from .conventions import get_cursorless_list_name

regex = re.compile(r"\{(\w+):([^}]+)\}")


def not_implemented(argument: str):
    raise NotImplementedError()


def process_literal_step(argument: str):
    return f"<cmd@{argument}/>"


def make_cursorless_list_reverse_look_up(*raw_list_names: str):
    return make_list_reverse_look_up(
        *[get_cursorless_list_name(raw_list_name) for raw_list_name in raw_list_names]
    )


def make_list_reverse_look_up(*list_names: str):
    """
    Given a list of talon list names, returns a function that does a reverse
    look-up in all lists to find the spoken form for its input.
    """

    def return_func(argument: str):
        for list_name in list_names:
            for spoken_form, value in registry.lists[list_name][-1].items():
                if value == argument:
                    return f'<*"{spoken_form}"/>'

        raise LookupError(f"Unknown identifier `{argument}`")

    return return_func


interpolation_processor_map: dict[str, Callable[[str], str]] = {
    "literalStep": process_literal_step,
    "action": make_cursorless_list_reverse_look_up(*ACTION_LIST_NAMES),
    "scopeType": make_cursorless_list_reverse_look_up(*SCOPE_LIST_NAMES),
    "step": lambda name: name,
}


def process_tutorial_step(raw: str):
    print(f"{raw=}")
    current_index = 0
    content = ""
    for match in regex.finditer(raw):
        content += raw[current_index : match.start()]
        content += interpolation_processor_map[match.group(1)](match.group(2))
        current_index = match.end()
    content += raw[current_index : len(raw)]
    print(f"{content=}")

    return {
        "content": content,
        "restore_callback": print,
        "modes": ["command"],
        "app": "Code",
        "context_hint": "Please open VSCode and enter command mode",
    }


def get_basic_coding_walkthrough():
    with open(
        "/Users/pokey/src/cursorless-vscode/src/test/suite/fixtures/recorded/tutorial/unit-2-basic-coding/script.json"
    ) as f:
        script = json.load(f)

    return [
        actions.user.hud_create_walkthrough_step(**process_tutorial_step(step))
        for step in script
    ]


def on_ready():
    actions.user.hud_add_lazy_walkthrough(
        "Cursorless basic coding", get_basic_coding_walkthrough
    )


app.register("ready", on_ready)
