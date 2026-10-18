# IPMI (iDRAC, iLO, Supermicro)

Les serveurs en rack et en tour ont un contrôleur de gestion (BMC) qui les
surveille en permanence, même éteints : Dell iDRAC, HP iLO, Supermicro,
ASRock Rack, Lenovo IMM, Fujitsu iRMC… Presque tous parlent **IPMI sur
LAN**, le protocole des modèles anciens ou d'entrée de gamme si courants
dans les homelabs (Dell R710, R720, HP DL380 G7, Supermicro X9, X10). Cette
intégration le lit : un appareil par serveur avec son état, sa santé, sa
consommation, ses températures et ses ventilateurs. Les scènes peuvent
réagir quand un capteur sort de ses seuils, qu'une nouvelle entrée apparaît
dans le journal d'événements système (SEL) ou qu'un serveur s'allume ou
s'éteint, et un widget résume vos serveurs sur le tableau de bord. Le
pilotage de l'alimentation (allumage, arrêt doux) est possible, **désactivé
par défaut**. Tout reste sur votre réseau local.

Pour un contrôleur récent (iDRAC 8 et 9, iLO 4 à 6), l'intégration
[Redfish](https://github.com/guim31/gladys-redfish) donne le même appareil
avec une API plus riche ; celle-ci sert aux contrôleurs qui ne parlent
qu'IPMI, ou à ceux qui le préfèrent.

**Développée sans le matériel : vos retours sont les bienvenus.** Testée
contre le simulateur de BMC d'OpenIPMI (`ipmi_sim`, Docker) avec le vrai
`ipmitool` : sessions, capteurs et seuils, état d'alimentation, journal
d'événements, commandes, mauvais mot de passe, privilège insuffisant, BMC
injoignable. Les noms des capteurs des constructeurs viennent de leur
documentation. Dites-nous comment ça se passe sur votre serveur dans
[les issues](https://github.com/guim31/gladys-ipmi/issues).

## Ce qu'il faut

- Gladys Assistant 5.1.0 ou plus récent.
- Un serveur dont le BMC a **IPMI sur LAN** activé : Dell iDRAC 6 à 9, HP
  iLO 2 à 5, Supermicro, ASRock Rack, Lenovo IMM, Fujitsu iRMC, la plupart
  des autres.
- Le BMC joignable depuis la machine de Gladys sur le port UDP 623.
- Un compte IPMI sur le BMC. Le privilège **Utilisateur** (User) suffit
  pour lire ; le pilotage demande **Opérateur** (ou Administrateur).
- Jusqu'à trois BMC par installation de l'intégration.

## Mise en route

### 1. Préparer le BMC

- **Activez IPMI sur LAN** : désactivé par défaut sur beaucoup de BMC. Sur
  un iDRAC : _Paramètres iDRAC → Réseau → Paramètres IPMI → Activer IPMI
  sur LAN_. Sur un iLO : _Administration → Access Settings → IPMI/DCMI over
  LAN_. Supermicro et ASRock Rack l'ont actif.
- Créez si possible un compte dédié, avec le privilège Utilisateur si vous
  ne voulez pas piloter l'alimentation. Son mot de passe doit faire
  20 caractères au plus (16 en IPMI 1.5).
- Si vous avez `ipmitool` sous la main, vérifiez depuis une autre machine :
  `ipmitool -I lanplus -H <adresse> -U <utilisateur> -P <mot de passe> chassis status`.

### 2. Configurer l'intégration

Dans l'onglet **Configuration** de l'intégration :

- **Adresse du BMC** : `192.168.1.30` ou `idrac.lan`, avec `:port` si ce
  n'est pas 623 (`idrac.lan:6230`). Une adresse IPv6 fonctionne aussi.
- **Nom d'utilisateur** et **Mot de passe** du compte IPMI.
- **Nom** (facultatif) : affiché dans le nom de l'appareil, le widget et
  les messages. Par défaut, le nom du produit donné par le BMC
  (`PowerEdge R720`), sinon son adresse.
- Jusqu'à deux autres BMC dans les sections suivantes.
- **Interface IPMI** : IPMI 2.0 (`lanplus`, chiffré), par défaut, pour tout
  BMC depuis 2008 environ. IPMI 1.5 (`lan`) seulement pour un BMC plus
  ancien qui refuse IPMI 2.0.
- **Intervalle de rafraîchissement** : de 30 secondes à 5 minutes
  (1 minute par défaut).
- **Autoriser le pilotage de l'alimentation** : voir
  [Pilotage de l'alimentation](#pilotage-de-lalimentation). Désactivé par
  défaut.
- **Langue des noms** : langue des noms des fonctionnalités (fixés à
  l'ajout du serveur), des textes de santé et des résultats de scène.

Cliquez ensuite sur **Tester la connexion** : une ligne par BMC, avec le
serveur trouvé, le nombre de capteurs et la présence de la mesure de
puissance DCMI.

### 3. Ajouter le serveur

Le serveur apparaît dans l'onglet **Découverte** de l'intégration :
ajoutez-le. Seuls les serveurs ajoutés reçoivent des valeurs ; le widget et
les déclencheurs de scène fonctionnent pour tous les serveurs, ajoutés ou
non.

## L'appareil

Un appareil par BMC. Seules les fonctionnalités que le BMC fournit sont
proposées :

| Fonctionnalité                           | Valeur                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| Alimentation                             | Allumé ou éteint. Un interrupteur si le pilotage est autorisé          |
| Santé                                    | OK, Avertissement ou Critique : défauts du châssis et capteurs         |
| Consommation                             | Watts consommés (mesure DCMI, ou un capteur en watts)                  |
| Température d'entrée                     | L'air qui entre dans le serveur, en °C                                 |
| Température processeur                   | Le processeur le plus chaud, en °C                                     |
| Température maximale                     | Le plus chaud de tous les capteurs de température, en °C               |
| Ventilateurs (tr/min) / Ventilateurs (%) | La vitesse moyenne des ventilateurs, dans l'unité du BMC               |
| Capteurs hors seuil                      | Combien de capteurs ont passé un seuil ou signalent une panne ; 0 = OK |

L'appareil montre aussi le numéro de série et le firmware du BMC dans ses
paramètres. Quand le BMC ne répond pas, l'appareil porte le badge
« injoignable » et le statut sous le nom de l'intégration dit pourquoi.

Un capteur est **hors seuil** quand le BMC dit qu'il a franchi l'un de ses
seuils (non critique : Avertissement ; critique ou irrécupérable :
Critique), ou quand un capteur d'état signale une panne (« Failure
detected », « AC lost », « Redundancy Lost »…). Les seuils sont ceux du
BMC : l'intégration n'en ajoute aucun.

## Tableau de bord

Le widget **Serveurs (IPMI)** a deux modes :

- **sans serveur choisi** : une ligne par serveur, allumé ou éteint, santé
  et consommation, en orange ou rouge en cas de problème ;
- **avec un serveur choisi** : sa consommation, ses températures d'entrée
  et maximale en tuiles, puis son alimentation, sa santé, ses ventilateurs
  et les capteurs hors seuil. Si le pilotage est autorisé, le bouton
  **Éteindre** (serveur allumé) ou **Allumer** (serveur éteint) apparaît,
  avec une confirmation.

**Actualiser** relit les BMC.

## Scènes

### Déclencheurs

- **Capteur hors seuil** : un capteur franchit un seuil ou signale une
  panne, ou passe d'Avertissement à Critique. Il peut être limité à un
  serveur et à une gravité (Avertissement ou Critique). Variables :
  serveur, capteur, valeur lue, gravité. Cinq au plus par serveur et par
  lecture.
- **Nouvelle entrée du journal système (SEL)** : une nouvelle entrée dans
  le SEL d'un serveur (seuil franchi, alimentation perdue, erreur mémoire,
  châssis ouvert…). Vérifié à chaque lecture, au plus une fois par minute ;
  trois au plus par lecture. Variables : serveur, message, date.
- **Serveur allumé** et **Serveur éteint** : quelle qu'en soit la cause
  (bouton, BMC, coupure de courant). Variable : serveur.

Chaque déclencheur peut être limité à un serveur. La première lecture après
l'installation enregistre seulement les états : rien n'est annoncé pour un
capteur ou une entrée déjà là.

### Actions

- **État d'un serveur** : lit un serveur et donne aux actions suivantes son
  nom, si le BMC répond, l'alimentation, la santé, la consommation, les
  températures, la vitesse des ventilateurs, les capteurs hors seuil, et un
  résumé prêt à envoyer (« r720 : allumé, santé OK, 172 W, entrée
  23 °C… »).
- **Commande d'alimentation** : allumage, arrêt doux (ACPI), redémarrage
  forcé (reset) ou cycle d'alimentation d'un serveur. Demande **Autoriser
  le pilotage de l'alimentation**.

### Idées de scènes

- Quand un **Capteur hors seuil** de gravité Critique se déclenche, envoyer
  le capteur et sa valeur sur Telegram.
- À 1 h, si personne n'est à la maison, **Commande d'alimentation** « Arrêt
  doux (ACPI) » sur le serveur du lab ; à 7 h, « Allumer ».
- Quand une **Nouvelle entrée du journal système (SEL)** apparaît sur le
  serveur NAS, notifier avec son message.

## Pilotage de l'alimentation

Désactivé par défaut. Une fois **Autoriser le pilotage de l'alimentation**
coché, cliquez sur **Mettre à jour** pour le serveur dans l'onglet
Découverte : la fonctionnalité **Alimentation** devient un interrupteur.

- Allumer envoie `chassis power on`.
- Éteindre envoie un **arrêt doux** (`chassis power soft` : le BMC appuie
  brièvement sur le bouton, le système d'exploitation s'arrête proprement,
  s'il gère l'ACPI). **Jamais de coupure franche** : un interrupteur basculé
  par erreur, un assistant vocal ou une scène ne doivent pas couper un
  serveur.
- Le redémarrage forcé (`chassis power reset`) et le cycle d'alimentation
  (`chassis power cycle`, coupure puis rallumage) ne sont que dans l'action
  de scène **Commande d'alimentation**, choisis explicitement, et refusés
  sur un serveur éteint.

L'état est relu juste avant chaque commande : rien n'est envoyé quand le
serveur est déjà dans l'état demandé. Le serveur est relu 15 secondes après
la commande, puis à l'intervalle habituel.

## Dépannage

- **« ne répond pas »** : vérifiez l'adresse, qu'IPMI sur LAN est activé
  dans le BMC et que le port UDP 623 est joignable depuis la machine de
  Gladys (autre VLAN, pare-feu ?). Un BMC derrière un NAT demande une
  redirection de port.
- **« nom d'utilisateur ou mot de passe refusé »** : vérifiez le compte
  dans l'interface web du BMC, et qu'il est autorisé en IPMI. Certains BMC
  verrouillent un compte après quelques échecs.
- **« le compte n'a pas le privilège nécessaire »** : donnez au compte au
  moins le privilège Utilisateur (Opérateur pour le pilotage) sur le canal
  LAN.
- **Rien en IPMI 2.0 sur un vieux BMC** : essayez l'**Interface IPMI**
  « IPMI 1.5 (lan) ».
- **Une fonctionnalité manque** : le BMC ne la fournit pas (pas de capteur
  d'entrée d'air, ni DCMI ni capteur en watts, capteurs processeur lisibles
  seulement serveur allumé).
- **Une commande refusée** : le compte n'a pas le privilège Opérateur.

## Limites

- Développée sans le matériel : testée contre le simulateur d'OpenIPMI, et
  les noms des capteurs des constructeurs viennent de leur documentation,
  pas encore de vrais serveurs.
- Les noms des capteurs sont libres, choisis par chaque constructeur : les
  températures d'entrée et processeur sont trouvées par leur entité IPMI,
  puis par leur nom. Un serveur qui les nomme autrement ne les montre que
  dans la température maximale.
- Le SEL est lu par ses 20 dernières entrées quand il a changé ; parcourir
  un long SEL prend quelques secondes sur certains BMC.
- Pas de redémarrage doux : IPMI n'en a pas. Faites un arrêt doux, puis
  allumez.
- IPMI 2.0 envoie le mot de passe haché, jamais en clair, mais le protocole
  est ancien : gardez les BMC sur un réseau à part.

## Crédits

L'intégration pilote [ipmitool](https://github.com/ipmitool/ipmitool)
(BSD 3-Clause), installé dans son image. Les tests rejouent des sorties
capturées sur le simulateur d'[OpenIPMI](https://github.com/cminyard/openipmi)
(LGPL/GPL, utilisé pour les tests seulement, non distribué). IPMI est une
spécification d'Intel, HP, NEC et Dell. Cette intégration n'est affiliée ni
à Dell, ni à HP, HPE, Supermicro, ASRock Rack, Lenovo, Fujitsu ou Intel.
