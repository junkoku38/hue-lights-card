# Hue Lights Card

Carte Lovelace pour lumières Philips Hue (et compatibles) dans Home Assistant.
Pièces en dégradé façon application Hue, scènes réelles découvertes dans HA,
sélecteur de couleur multi-lampes et garde-fous contre les appuis accidentels.

## Fonctionnalités

- **Découverte automatique** des lumières, regroupées par pièce (area)
- **Pièces en dégradé** : chaque vignette prend la couleur moyenne des lampes allumées
- **Scènes réelles** de Home Assistant : rattachées par pièce assignée, nom de groupe
  Hue ou recoupement des lampes pilotes
- **Sélecteur de couleur** : roue HSV + mode blanc (Kelvin), appliquée à une sélection
  multiple de lampes
- **Gestes configurables** : horizontal, vertical + appui long, ou aucun
- **Garde-fous** : annulation si la page a défilé, seuils de mouvement/durée, bandeau
  d'annulation qui restaure l'état exact de chaque lampe
- **Enregistrement de scènes** via `scene.create` (capture l'état des lampes)
- **Éditeur visuel** complet inclus

## Installation

HACS → Dépôts personnalisés → `https://github.com/junkoku38/hue-lights-card`,
catégorie Lovelace.

## Configuration

```yaml
type: custom:hue-lights-card
name: Lumières
layout: tiles        # tiles | rows
columns: 2
gesture: horizontal  # horizontal | vertical_hold | none
tap_action: open     # open | toggle
show_scenes: true
show_color_picker: true
```

### Sélection manuelle de lumières

Pour n'afficher que des lampes précises (pas toute la maison), utilise `entities` :

```yaml
type: custom:hue-lights-card
name: Mes lampes
entities:
  - light.salon_plafond
  - light.cuisine_plan
  - light.chambre_veilleuse
group_by_area: true   # true : regroupe par pièce ; false : une tuile par lampe
```

Si `entities` est rempli, la découverte automatique et le filtre `areas` sont ignorés.
Avec `group_by_area: false`, chaque lampe est sa propre tuile (pas de regroupement).

### Options

| Option | Type | Défaut | Description |
|---|---|---|---|
| `name` | string | `Lumières` | Titre de la carte |
| `layout` | `tiles` \| `rows` | `tiles` | Vignettes en grille ou barres horizontales |
| `columns` | number | `2` | Colonnes en mode `tiles` |
| `show_header` | bool | `true` | En-tête avec interrupteur général |
| `show_off` | bool | `true` | Afficher les pièces éteintes |
| `show_unassigned` | bool | `false` | Lumières sans pièce assignée |
| `gesture` | string | `horizontal` | Geste de réglage de l'intensité |
| `hold_ms` | number | `220` | Durée d'appui long en mode `vertical_hold` |
| `tap_action` | `open` \| `toggle` | `open` | Appui court sur la surface |
| `guard_scroll` | bool | `true` | Annuler si la page a défilé |
| `guard_thresholds` | bool | `true` | Seuils de mouvement (10 px) et durée (60 ms) |
| `undo` | bool | `true` | Bandeau d'annulation |
| `undo_ms` | number | `5000` | Durée d'affichage du bandeau |
| `show_scenes` | bool | `true` | Découvrir et afficher les scènes |
| `scene_match` | list | `["area","group","overlap"]` | Critères de rattachement |
| `max_scenes` | number | `12` | Nombre max de scènes par pièce |
| `scene_transition` | number | `1` | Transition en secondes |
| `allow_scene_create` | bool | `true` | Enregistrement de scènes |
| `learn_scene_colors` | bool | `true` | Mémoriser les couleurs des scènes |
| `show_color_picker` | bool | `true` | Sélecteur de couleur |
| `exclude` | list | `[]` | Motifs d'entités à exclure |
| `areas` | list | `null` | Filtrer par area ID ou nom |
| `entities` | list | `null` | Liste explicite d'entity_id (désactive la découverte auto) |
| `group_by_area` | bool | `true` | Regrouper par pièce (false : une tuile par lampe) |

## Navigation

1. **Grille** : toutes les pièces, interrupteur général en haut
2. **Pièce** : scènes + lampes, curseur d'intensité de la pièce
3. **Couleur** : roue HSV/blanc, sélection multiple des lampes

## Sécurité

Tous les noms d'entités et de scènes sont échappés HTML avant injection dans le DOM
(helper `esc()`), pour éviter l'exécution de HTML/JS depuis un `friendly_name` malicieux.

## License

MIT