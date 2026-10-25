'use strict';

const { escapeHTML } = require('./quest-fixture.cjs');

// Card, form, times, and material-row structure were inspected in the Workshop.
// Recipe IDs, tokens, and hidden action values here are test data.
function craftContent(skill, recipes, token = 'fixture-craft-token') {
  return `<h1>The Workshop</h1><div data-fold-group="craft-${skill}">${recipes.map(recipe => {
    const max = Math.min(...recipe.materials.map(item => Math.floor(item.owned / item.amount)));
    return `<div class="card" data-fold="recipe-${recipe.id}" data-fold-name="${escapeHTML(recipe.name)}">
      <h3>${escapeHTML(recipe.name)} Lvl 1+</h3><div class="fold-body" id="recipe-${recipe.id}">
      <div class="stat-row"><span>Makes</span><strong>1× Fixture item</strong></div>
      <p class="muted">Needs: ${recipe.materials.map(item => `<span>${item.amount}× ${escapeHTML(item.name)} (${item.owned})</span>`).join(', ')}</p>
      ${max > 0 && !recipe.locked ? `<form method="post" data-ajax><input type="hidden" name="csrf" value="${token}">
        <input type="hidden" name="action" value="craft"><input type="hidden" name="skill" value="${skill}">
        <input type="hidden" name="recipe_id" value="${recipe.id}"><input type="number" name="times" min="1" max="${max}" value="1">
        <button type="submit">Craft (max ${max})</button></form>` : '<p>Not enough materials or locked.</p>'}</div></div>`;
  }).join('')}</div>`;
}

module.exports = { craftContent };
