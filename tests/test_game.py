"""Tests for Fallows of Elysium - Alpha v0.0.1."""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest

from game.player import Player
from game.items import SHOP_ITEMS, use_item
from game.combat import Enemy, spawn_enemy, do_combat_round
from game.farming import plant, harvest, advance_crops, field_status, FIELD_PLOTS, HARVEST_TURNS
from game.world import LOCATIONS, get_location


# ---------------------------------------------------------------------------
# Player tests
# ---------------------------------------------------------------------------

class TestPlayer:
    def test_initial_state(self):
        p = Player("Hero")
        assert p.name == "Hero"
        assert p.hp == 100
        assert p.max_hp == 100
        assert p.level == 1
        assert p.xp == 0
        assert p.gold == 20
        assert p.inventory == []

    def test_take_damage_reduces_hp(self):
        p = Player("Hero")
        dmg = p.take_damage(20)
        assert dmg >= 1
        assert p.hp < 100

    def test_take_damage_minimum_1(self):
        p = Player("Tank", defense=999)
        dmg = p.take_damage(5)
        assert dmg == 1

    def test_heal_restores_hp(self):
        p = Player("Hero")
        p.hp = 50
        restored = p.heal(30)
        assert p.hp == 80
        assert restored == 30

    def test_heal_capped_at_max_hp(self):
        p = Player("Hero")
        p.hp = 90
        p.heal(100)
        assert p.hp == 100

    def test_is_alive_false_at_zero_hp(self):
        p = Player("Hero")
        p.hp = 0
        assert not p.is_alive()

    def test_gain_xp_no_level_up(self):
        p = Player("Hero")
        msg = p.gain_xp(50)
        assert msg is None
        assert p.xp == 50

    def test_gain_xp_triggers_level_up(self):
        p = Player("Hero")
        msg = p.gain_xp(100)
        assert msg is not None
        assert "Level Up" in msg
        assert p.level == 2

    def test_level_up_increases_stats(self):
        p = Player("Hero")
        old_attack = p.attack
        old_defense = p.defense
        old_max_hp = p.max_hp
        p.gain_xp(100)
        assert p.attack > old_attack
        assert p.defense > old_defense
        assert p.max_hp > old_max_hp

    def test_status_contains_name(self):
        p = Player("TestHero")
        assert "TestHero" in p.status()


# ---------------------------------------------------------------------------
# Items tests
# ---------------------------------------------------------------------------

class TestItems:
    def test_use_item_not_in_inventory(self):
        p = Player("Hero")
        msg = use_item("Health Potion", p)
        assert "don't have" in msg

    def test_use_health_potion_heals(self):
        p = Player("Hero")
        p.hp = 50
        p.inventory.append("Health Potion")
        msg = use_item("Health Potion", p)
        assert p.hp > 50
        assert "Health Potion" not in p.inventory

    def test_use_item_removes_from_inventory(self):
        p = Player("Hero")
        p.inventory.append("Health Potion")
        use_item("Health Potion", p)
        assert "Health Potion" not in p.inventory

    def test_shop_items_all_have_cost(self):
        for item in SHOP_ITEMS.values():
            assert item.cost > 0


# ---------------------------------------------------------------------------
# Combat tests
# ---------------------------------------------------------------------------

class TestCombat:
    def test_spawn_enemy_returns_enemy(self):
        enemy = spawn_enemy(1)
        assert isinstance(enemy, Enemy)
        assert enemy.hp > 0

    def test_enemy_take_damage(self):
        enemy = Enemy("Test", hp=50, max_hp=50, attack=5, defense=0, xp_reward=10, gold_reward=5)
        dmg = enemy.take_damage(10)
        assert dmg == 10
        assert enemy.hp == 40

    def test_enemy_take_damage_minimum_1(self):
        enemy = Enemy("Tank", hp=50, max_hp=50, attack=5, defense=999, xp_reward=10, gold_reward=5)
        dmg = enemy.take_damage(5)
        assert dmg == 1

    def test_combat_round_reduces_enemy_hp(self):
        p = Player("Hero", attack=100)
        enemy = Enemy("Weak", hp=10, max_hp=10, attack=1, defense=0, xp_reward=5, gold_reward=1)
        log, over = do_combat_round(p, enemy)
        assert over  # one-shot kill
        assert "defeated" in log

    def test_combat_round_enemy_can_kill_player(self):
        p = Player("Glass", hp=1, max_hp=100, attack=1, defense=0)
        enemy = Enemy("Boss", hp=100, max_hp=100, attack=999, defense=0, xp_reward=0, gold_reward=0)
        log, over = do_combat_round(p, enemy)
        assert not p.is_alive()
        assert over


# ---------------------------------------------------------------------------
# Farming tests
# ---------------------------------------------------------------------------

class TestFarming:
    def _fresh_player(self):
        return Player("Farmer")

    def test_plant_valid_plot(self):
        p = self._fresh_player()
        msg = plant(p, FIELD_PLOTS[0])
        assert "plant" in msg.lower()
        assert FIELD_PLOTS[0] in p.fields

    def test_plant_invalid_plot(self):
        p = self._fresh_player()
        msg = plant(p, "Nonexistent Plot")
        assert "not a valid plot" in msg

    def test_plant_already_planted(self):
        p = self._fresh_player()
        plant(p, FIELD_PLOTS[0])
        msg = plant(p, FIELD_PLOTS[0])
        assert "already planted" in msg

    def test_harvest_before_ready(self):
        p = self._fresh_player()
        plant(p, FIELD_PLOTS[0])
        msg = harvest(p, FIELD_PLOTS[0])
        assert "not ready" in msg

    def test_harvest_after_full_growth(self):
        p = self._fresh_player()
        plant(p, FIELD_PLOTS[0])
        # Fast-forward by setting turns to HARVEST_TURNS
        p.fields[FIELD_PLOTS[0]] = HARVEST_TURNS
        msg = harvest(p, FIELD_PLOTS[0])
        assert "harvest" in msg.lower()
        assert p.grain > 0
        assert FIELD_PLOTS[0] not in p.fields

    def test_advance_crops_increments_turns(self):
        p = self._fresh_player()
        plant(p, FIELD_PLOTS[0])
        advance_crops(p)
        assert p.fields[FIELD_PLOTS[0]] == 1

    def test_advance_crops_returns_notice_when_ready(self):
        p = self._fresh_player()
        plant(p, FIELD_PLOTS[0])
        p.fields[FIELD_PLOTS[0]] = HARVEST_TURNS - 1
        msg = advance_crops(p)
        assert msg is not None
        assert FIELD_PLOTS[0] in msg

    def test_field_status_shows_all_plots(self):
        p = self._fresh_player()
        status = field_status(p)
        for plot in FIELD_PLOTS:
            assert plot in status


# ---------------------------------------------------------------------------
# World tests
# ---------------------------------------------------------------------------

class TestWorld:
    def test_all_locations_have_names(self):
        for loc in LOCATIONS:
            assert loc.name

    def test_get_location_found(self):
        loc = get_location("The Homestead")
        assert loc is not None
        assert loc.has_fields

    def test_get_location_not_found(self):
        loc = get_location("Nowhere")
        assert loc is None

    def test_homestead_is_safe(self):
        loc = get_location("The Homestead")
        assert loc.danger_level == 0

    def test_greyveil_has_shop(self):
        loc = get_location("Greyveil Market")
        assert loc.has_shop

    def test_dangerous_zones_have_danger_level(self):
        for loc in LOCATIONS:
            if loc.name not in ("The Homestead", "Greyveil Market"):
                assert loc.danger_level > 0
