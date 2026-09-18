# Main Assemblies (Aero Vault 0.4 pilot)

`Main Assemblies` is a protected system folder. Its assemblies feed one protected aircraft master, `SAEAEROMAIN.SLDASM`. Downloaded revisions are Pack and Go ZIPs containing the root assembly, its referenced CAD files, and a revision manifest. The master remains a normal SolidWorks assembly: it does not merge the aircraft into a single part.

## First setup

1. Install Aero Vault 0.4 in Windows and enable the add-in in SolidWorks 2026.
2. Upload individual parts from their subsystem using **Use active SolidWorks design**. Wait for their saved revision to finish syncing.
3. Insert those exact local linked files into your subassembly. Save all modified files. Upload the subassembly using **Use active SolidWorks design** in **Main Assemblies**. Pack and Go automatically includes dependencies and records the linked package IDs. Repeat for other subassemblies.
4. Save and close all open CAD documents. Keep SolidWorks running and Aero Vault signed in. In Main Assemblies choose **Create SAEAEROMAIN**, then upload the prepared master. Set a default assembly template in SolidWorks Options if prompted.
5. The new master stays open. Position and mate its subassemblies, then save all modified documents. Subsequent saves use the existing automatic sync pipeline.

Use unique CAD filenames for distinct designs throughout the aircraft. File display names in Aero Vault are independent of CAD filenames. A linked CAD root cannot be renamed in place; use a new package for a Save As design.

An existing assembly imported before 0.4 needs to be prepared and uploaded once with 0.4. Files not linked to a cloud package are embedded snapshots; filenames alone never establish a live link. To establish a link, insert the actual locally linked source file and prepare the assembly again. The details panel shows how many packages are tracked.

## Updating the aircraft

Edit an individual design through its own subsystem package and save. Once its cloud revision is acknowledged, linked assemblies become pending. The planner processes them from children to parents, then rebuilds SAEAEROMAIN. New assemblies added to Main Assemblies are appended to the existing master at the origin; open the latest master to position and mate those new components.

Rebuilds require **an idle SolidWorks 2026 process with all CAD documents closed and Aero Vault signed in**. They run about every 30 seconds. The website stores and coordinates revisions; it cannot run the SolidWorks CAD engine. If everyone closes SolidWorks, work waits until an eligible signed-in installation is available. Keep the panel open during a rebuild. Multiple installations coordinate through editing leases.

Opening a master downloads a self-contained snapshot. Edit source parts through their subsystem packages to publish their individual revisions. Editing an embedded copy inside the master does not publish that part's separate subsystem package.

Rebuilds use a new staging directory and the last published assembly. Existing component instances are retained, preserving their saved transforms and mate definitions. The add-in checks document-open warnings, rebuild results, and feature/mate errors across configurations. A failed check preserves the previous cloud revision and reports the issue in assembly details. This is not an engineering validation or an interference check; inspect changed geometry and new components in SolidWorks.

Saved user working copies are never overwritten by the assembly worker. Unsynced local copies or active editing leases defer processing. Each successful rebuild creates an immutable revision. If inputs change during publication, the generated candidate is retained locally and the planner retries with fresh inputs.

## Limits and recovery

- SolidWorks 2026 only for this pilot; 2025 compatibility is unchanged.
- Maximum ZIP size: 50 MB; 512 CAD files per manifest; 64 direct tracked package references. Large aircraft may need a later storage-limit increase.
- Missing references, duplicate filenames with differing bytes, cycles, changed root filenames, or rebuild warnings require review. No automatic mate repair or component removal is performed.
- The master requires one-time creation and positioning. New top-level components need positioning review after being appended.
- All configurations are checked, but geometry changes can remain mechanically unsuitable despite rebuilding successfully.
- A failed candidate's local path appears in the status when CAD validation fails. Keep that copy if needed, repair the source or latest parent revision, save, and close documents to retry.
- Windows manifest/ZIP tests and server revision tests run automatically. Actual SolidWorks Pack and Go, component insertion, configuration rebuilds, and mate preservation still require validation on a SolidWorks workstation before broad team use.

## Workstation acceptance check

Start with two small parts and a subassembly. Link the parts, add a mate, upload the subassembly to Main Assemblies, and create/position the master. Change a part dimension, save, then close documents. Verify that the subassembly and master each receive a new revision, geometry changes, and the saved positions/mates remain. Change a mated face to intentionally break a mate and verify that the last published master remains available with a review message. Test new subassembly insertion, conflicting filenames, a second editor, and restart during a queued upload before using the full aircraft.
