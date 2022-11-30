import { logger } from "@citation-js/core";
import { parse as parseNameString } from "@citation-js/name";
import { parse as parseDate } from "@citation-js/date";

import config from "./config.json" assert { type: "json" };

/**
 * CSL mappings for Wikidata instances.
 * @access private
 * @constant types
 * @memberof module:@citation-js/plugin-wikidata.parsers.prop
 */
import types from "./types.json" assert { type: "json" };

/**
 * Some name fields have, in addition to a Wikidata ID, a qualifier stating
 * how the name is actually represented. That's what we want to cite.
 *
 * @access private
 * @memberof module:@citation-js/plugin-wikidata.parsers.prop
 * @param {Object} qualifiers
 * @return {Array<String>} names
 */
function getStatedAs(qualifiers) {
	return [].concat(...[qualifiers.P1932, qualifiers.P1810].filter(Boolean));
}

/**
 * Get a single name
 *
 * @access private
 * @memberof module:@citation-js/plugin-wikidata.parsers.prop
 * @param {Object} claim - name claim
 * @return {Object} Name object
 */
function parseName({ value, qualifiers }) {
	let [name] = getStatedAs(qualifiers);
	if (!name) {
		name = typeof value === "string" ? value : getLabel(value);
	}
	name = name ? parseNameString(name) : { literal: name };
	const ordinal = qualifiers.P1545 ? parseInt(qualifiers.P1545[0]) : null;
	if (ordinal !== null) {
		name._ordinal = ordinal;
	}
	return name;
}

/**
 * Get names
 *
 * @access private
 * @memberof module:@citation-js/plugin-wikidata.parsers.prop
 * @param {Array<Object>} values
 * @return {Array<Object>} Array with name objects
 */
function parseNames(values) {
	let placed = [];
	let unplaced = [];
	values
		.map(parseName)
		.sort((a, b) => b._ordinal - a._ordinal)
		.forEach((name) => {
			name._ordinal ? (placed[name._ordinal] = name) : unplaced.push(name);
		});
	return placed.push(...unplaced);
}

/**
 * Get place name from (publisher) entity.
 *
 * @access private
 * @memberof module:@citation-js/plugin-wikidata.parsers.prop
 * @param {Object} value
 * @return {String} Place name + country
 */
function getPlace(value) {
	const country = value.claims.P17[0].value;
	// only short names that are not an instance of (P31) emoji flag seqs. (Q28840786)
	const shortNames = country.claims.P1813.filter(
		({ qualifiers: { P31 } }) => !P31 || P31[0] !== "Q28840786",
	);
	return (
		getLabel(value) + ", " + (shortNames[0] || country.claims.P1448[0]).value
	);
}

/**
 * Get title either from explicit statement or from label.
 *
 * @access private
 * @memberof module:@citation-js/plugin-wikidata.parsers.prop
 * @param {Object} value
 * @return {String} Title
 */
function getTitle(value) {
	return value.claims.P1476 ? value.claims.P1476[0].value : getLabel(value);
}

function filterByPropertyEntity(
	data,
	{ property = "P31", entity = "Q41719" } = {},
) {
	return data.filter(
		(item) =>
			item?.value?.claims?.[property]?.filter((y) => y.value.id == entity)
				.length,
	);
}

/**
 * Turn array of entities into comma-separated list of labels.
 *
 * @access private
 * @memberof module:@citation-js/plugin-wikidata.parsers.prop
 * @param {Array<Object>} values
 * @return {String} Labels
 */
function parseKeywords(values, type = null) {
	const hypos = filterByPropertyEntity(values);
	if (type === "hypothesis") {
		return hypos.map(({ value: { id, labels } }) => ({
			id: id,
			label: labels.en,
		}));
	} else {
		return values
			.filter((x) => !hypos.includes(x))
			.map(({ value }) => getLabel(value))
			.join(",");
	}
}

/**
 * Get date parts from multiple statements.
 *
 * @access private
 * @memberof module:@citation-js/plugin-wikidata.parsers.prop
 * @param {Array<Object>} values
 * @return {Array<Array<Number>>} Array of date-parts
 */
function parseDateRange(dates) {
	return {
		"date-parts": dates
			.map((date) => parseDate(date.value))
			.filter((date) => date && date["date-parts"])
			.map((date) => date["date-parts"][0]),
	};
}

/**
 * Get version information.
 *
 * @access private
 * @memberof module:@citation-js/plugin-wikidata.parsers.prop
 * @param {Array<Object>} values
 * @return {Array<Array<Number>>} Array of date-parts
 */
function parseVersion(version) {
	const output = { version: version.value };
	if (version.qualifiers.P577) {
		output.issued = parseDate(version.qualifiers.P577[0]);
	}
	if (version.qualifiers.P356) {
		output.DOI = version.qualifiers.P356[0];
	}
	if (version.qualifiers.P6138) {
		output.SWHID = version.qualifiers.P6138[0];
	}
	return output;
}

export const TYPE_PRIORITIES = {
	"review-book": 10,
	review: 9,
	"entry-dictionary": 5,
	"entry-encyclopedia": 5,
	map: 5,
	dataset: 4,
	legislation: 1,

	"article-magazine": 0,
	bill: 0,
	chapter: 0,
	classic: 0,
	collection: 0,
	entry: 0,
	figure: 0,
	graphic: 0,
	hearing: 0,
	interview: 0,
	legal_case: 0,
	manuscript: 0,
	motion_picture: 0,
	musical_score: 0,
	pamphlet: 0,
	"paper-conference": 0,
	patent: 0,
	personal_communication: 0,
	"post-weblog": 0,
	report: 0,
	song: 0,
	speech: 0,
	standard: 0,
	thesis: 0,
	treaty: 0,

	broadcast: -1,
	"article-newspaper": -1,
	"article-journal": -1,
	periodical: -2,
	regulation: -2,
	post: -5,
	webpage: -6,
	software: -7,
	article: -9,
	book: -10,
	performance: -11,
	event: -12,
	document: -100,
};

/**
 * Transform property and value from Wikidata format to CSL.
 *
 * Returns additional _ordinal property on authors.
 *
 * @access protected
 * @method parse
 * @memberof module:@citation-js/plugin-wikidata.parsers.prop
 *
 * @param {String} prop
 * @param {Array|String} values
 * @param {Object} entity
 *
 * @return {String|Array<Object>} CSL value
 */
export function parseProp(prop, value, entity) {
	switch (prop) {
		case "type":
			return parseType(value);

		case "author":
		case "chair":
		case "curator":
		case "container-author":
		case "collection-editor":
		case "composer":
		case "director":
		case "editor":
		case "executive-producer":
		case "guest":
		case "host":
		case "illustrator":
		case "narrator":
		case "organizer":
		case "original-author":
		case "performer":
		case "producer":
		case "recipient":
		case "reviewed-author":
		case "script-writer":
		case "translator":
			return parseNames(value);

		case "issued":
		case "original-date":
			return parseDate(value);

		case "event-date":
			return parseDateRange(value);

		case "hypothesis":
			return parseKeywords(value, "hypothesis");

		case "keyword":
			return parseKeywords(value);

		case "container-title":
		case "collection-title":
		case "event-title":
		case "medium":
		case "publisher":
		case "original-publisher":
			return getTitle(value);

		case "event-place":
		case "jurisdiction":
		case "original-publisher-place":
		case "publisher-place":
			return getPlace(value);

		case "chapter-number":
		case "collection-number":
			return parseInt(value[0]);

		case "number-of-volumes":
			return value.length;

		case "versions":
			return value.map(parseVersion);

		default:
			return value;
	}
}

/**
 * @access protected
 * @memberof module:@citation-js/plugin-wikidata.parsers.prop
 * @param {String|Array<String>} type - P31 Wikidata ID value
 * @return {String} CSL type
 */
export function parseType(type) {
	const unmapped = Array.isArray(type) ? type : [type];
	const mapped = unmapped.map((type) => types[type.value]).filter(Boolean);

	if (!mapped.length) {
		logger.unmapped("[plugin-wikidata]", "publication type", type);
		return "document";
	}

	mapped.sort((a, b) => TYPE_PRIORITIES[b] - TYPE_PRIORITIES[a]);

	return mapped[0];
}

/**
 * Get the labels of objects
 *
 * @access protected
 * @memberof module:@citation-js/plugin-wikidata.parsers.prop
 * @param {Object} entity - Wikidata API response
 * @return {String} label
 */
export function getLabel(entity) {
	if (!entity) {
		return undefined;
	}

	const lang = config.langs.find((lang) => entity.labels[lang]);
	return entity.labels[lang];
}

export { parseProp as parse, parseProp as default };
