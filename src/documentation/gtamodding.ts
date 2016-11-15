'use strict';
import {GTA3DocumentationProvider, docrequest, CommandDoc, GameDoc, ArgumentDoc} from './interface';
import {GTA3ScriptController, Command} from '../controller';
const cheerio = require('cheerio')

// TODO compare the cost of requesting the full page and performing our parsing,
// versus doing as we it is currently, quering only the first part with MediaWiki,
//    parsing the JSON, then performing our parsing.

export class GTAModdingDocumentationProvider implements GTA3DocumentationProvider {
    public getProviderName(): string {
        return "GTAModding";
    }

    public provideDocumentation(context: GTA3ScriptController,
                                command: Command): Promise<CommandDoc>
    {
        if(command.id == null) {
            return Promise.resolve(null);
        }

        let opcode = ("0000" + (command.id).toString(16)).slice(-4).toUpperCase();
        let query = `http://www.gtamodding.com/api.php?action=query&titles=${opcode}&prop=revisions&format=json&rvprop=content&rvexpandtemplates&rvsection=0`;
        return docrequest(query).then(body => {
            let result = { 
                uri: `http://www.gtamodding.com/wiki/${opcode}`, 
                games: new Array<GameDoc>(),
                shortDescription: null,
                longDescription: null,
                args: new Array<ArgumentDoc>(),
                examples: [],
            };

            let queryResult = JSON.parse(body);
            let queryPages  = queryResult.query.pages;
            let pageContent = null;

            // pick first entry in queryPages into pageContent
            for(let pageid in queryPages) {
                let page = queryPages[pageid];
                if(page.hasOwnProperty("missing")) {
                    return Promise.resolve(null);
                }
                pageContent = page.revisions[0]["*"];
                break;
            }

            let $ = cheerio.load(pageContent);

            let gameIcons = $("span.icon-align").html();
            if(gameIcons.indexOf("File:Sa.png") != -1) result.games.push(GameDoc.SanAndreas);
            if(gameIcons.indexOf("File:Vc.png") != -1) result.games.push(GameDoc.Miami);
            if(gameIcons.indexOf("File:Gta3.png") != -1) result.games.push(GameDoc.Liberty);

            let i = -1;
            let dtTable = { "Description": 1, "Syntax": 2, "Parameter": 3 }
            let paramNames = null;
            $("dl.opcode").children().each((_, elem) => {
                if(elem.name == "dt") {
                    i = dtTable[$(elem).html()] || -1;
                } else if(elem.name == "dd") {
                    if(i == 1) { // Description
                        result.shortDescription = this.parseWikiText($(elem).text());
                    } else if(i == 2) { // Syntax
                        let text = $(elem).text();
                        // Discard 0000: or Class.Method syntax.
                        if(!text.match(/^(?:(?:[A-Fa-f0-9]{4}:)|(?:[\w]+\.[\w]+))/)) {
                            // Store the parameter names to use while parsing the 'Parameter' entries.
                            let regex = /\[''(\w+)''\]/g;
                            let match = regex.exec(text);
                            let paramCount = 0;
                            paramNames = {}
                            while (match != null) {
                                paramNames[match[1]] = paramCount++;
                                match = regex.exec(text);
                            }
                            result.args = new Array<ArgumentDoc>(paramCount);
                        }
                    } else if(i == 3 && paramNames) { // Parameter
                        let currentParamName = null;
                        $(elem.firstChild).children().each((pid, pelem) => {
                            // Assumes even nodes are <dt> and odd are <dd>
                            if((pid % 2) == 0) { // <dt>
                                let regex = /\[''(\w+)''\]/;
                                let match = regex.exec($(pelem).text());
                                currentParamName = (match && match[1]) || null;
                            } else { // <dd>
                                let index = paramNames[currentParamName];
                                if(index != null) {
                                    result.args[index] = {
                                        type: null,
                                        description: this.parseWikiText($(pelem).html()),
                                    };
                                }
                            }
                        });
                    }
                }
            });
            
            let pageText = $.root().contents().last().text();
            let signString = "[[Category:OpCodes]]\n\n";
            if(pageText && pageText.startsWith(signString)) {
                let longDescription = pageText.substr(signString.length);
                result.longDescription = this.parseWikiText(longDescription);
            }

            return result;
        });
    }

    /// Parses a MediaWiki paragraph into Markdown.
    private parseWikiText(text: string): string {
        return text.replace(/\[\[([\w ]+)\|([^\]]+)\]\]/, "[$2](http://www.gtamodding.com/wiki/$1)")
                   .replace(/\[\[([^\]]+)\]\]/g, "[$1](http://www.gtamodding.com/wiki/$1)")
                   .replace(/'''([\w ]+)'''/, "**$1**")
                   .replace(/''([\w ]+)''/, "*$1*");
    }
}
